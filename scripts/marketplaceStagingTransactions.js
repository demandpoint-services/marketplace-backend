const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MongoClient } = require("mongodb");
const { readConfig, verifyDatabase, verifyTransactions } = require("../src/config/marketplaceStaging");
const { createChat, verifyIndexes, chatCollection } = require("../src/services/marketplaceStagingChat");
const { ids } = require("./marketplaceStagingFixtures");

async function verifyChatTransactions(env) {
  const { uri } = readConfig(env);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const db = (await client.connect()).db();
    await verifyDatabase(db);
    await verifyTransactions(client, db);
    await verifyIndexes(db);
    const threadId = ids.conversations[0];
    const [sender, recipient] = ids.users;
    const conversations = chatCollection(db, "conversations");
    const messages = chatCollection(db, "messages");
    const initial = await conversations.findOne({ _id: threadId, marketplaceChatFixture: "stage-1b-v1" });
    if (!initial || initial.artisanUnreadCount !== 2 || initial.clientUnreadCount !== 2 ||
        await messages.countDocuments({ conversation: threadId }) !== 36) {
      throw new Error("A fresh offline-to-API fixture run is required.");
    }
    const mutation = { text: "Synthetic transaction verification", clientMutationId: randomUUID() };
    const filter = { conversation: threadId, sender, clientMutationId: mutation.clientMutationId };
    const inject = createChat(db, client, { afterMessageInsert: async () => { throw new Error("Synthetic rollback check"); } });
    await assert.rejects(inject.send(threadId, sender, mutation), { message: "Synthetic rollback check" });
    assert.equal(await messages.countDocuments(filter), 0);
    const after = await conversations.findOne({ _id: threadId });
    assert.deepEqual(after, initial);
    const chat = createChat(db, client);
    // Discard the original response to model a committed send whose reply never reaches the client.
    await chat.send(threadId, sender, mutation);
    const replay = await chat.send(threadId, sender, mutation);
    const row = await messages.findOne(filter);
    assert.equal(replay.replayed, true);
    assert.equal(await messages.countDocuments(filter), 1);
    assert.ok(row._id.equals(replay.message._id));
    const committed = await conversations.findOne({ _id: threadId });
    assert.ok(committed.lastMessage.equals(row._id));
    assert.equal(committed.artisanUnreadCount, await chat.unread(recipient));
    assert.equal(committed.artisanUnreadCount, initial.artisanUnreadCount + 1);
    assert.deepEqual(Object.keys(committed.lastStagingNotification).sort(), ["createdAt", "messageId", "recipientId", "type"]);
    assert.ok(committed.lastStagingNotification.messageId.equals(row._id));
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    assert.ok(collections.every(item => !["marketplace_chat_notifications", "marketplace_chat_notificationpreferences"].includes(item.name)));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  verifyChatTransactions(process.env).then(() => console.log("Marketplace staging transaction checks passed."))
    .catch(() => { console.error("Marketplace staging transaction verification failed."); process.exitCode = 1; });
}
