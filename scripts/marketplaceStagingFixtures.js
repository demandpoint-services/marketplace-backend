const bcrypt = require("bcryptjs");
const { ObjectId, MongoClient } = require("mongodb");
const { readConfig, verifyDatabase, verifyTransactions } = require("../src/config/marketplaceStaging");
const { indexes, verifyIndexes, collectionName, chatCollection } = require("../src/services/marketplaceStagingChat");
const { synthetic } = require("../src/marketplaceStagingApp");

const collectionNames = Object.keys(indexes);
const roles = ["client", "artisan", "unrelated", "suspended"];
const id = n => new ObjectId(n.toString(16).padStart(24, "0"));
const ids = { users: [1, 2, 3, 4].map(id), artisanprofiles: [id(5)], bookings: [6, 7, 8].map(id),
  conversations: [id(9), id(10)], messages: Array.from({ length: 36 }, (_, i) => id(100 + i)) };

async function prepare(db) {
  for (const [name, definitions] of Object.entries(indexes)) {
    await db.createCollection(collectionName(name)).catch(error => { if (error.code !== 48) throw error; });
    if (definitions.length) await chatCollection(db, name).createIndexes(definitions);
  }
  await verifyIndexes(db);
}

async function checkFixtureScope(db, session) {
  for (const name of collectionNames) {
    const count = await chatCollection(db, name).countDocuments({ $nor: [synthetic] }, { session });
    if (count) throw new Error("The database contains records outside the designated fixture scope.");
  }
}

async function seed(db, client, password) {
  if (typeof password !== "string" || Buffer.byteLength(password) < 16 || Buffer.byteLength(password) > 72) {
    throw new Error("Set MARKETPLACE_FIXTURE_PASSWORD to a synthetic password of 16–72 bytes.");
  }
  const hash = await bcrypt.hash(password, 12);
  await client.withSession(session => session.withTransaction(async () => {
    await checkFixtureScope(db, session);
    for (const name of collectionNames) {
      if (await chatCollection(db, name).countDocuments({}, { session })) throw new Error("Fixture scope must be empty before seeding.");
    }
    const now = new Date("2025-06-01T09:00:00Z");
    const times = { createdAt: now, updatedAt: now };
    const [customer, professional] = ids.users;
    await chatCollection(db, "users").insertMany(ids.users.map((_id, i) => ({ _id, ...synthetic, ...times,
      name: ["Sample Client", "Sample Artisan", "Sample Other Client", "Sample Suspended"][i],
      email: "chat-" + roles[i] + "@demandpoint.test", password: hash, role: i === 1 ? "artisan" : "client",
      isVerified: true, isSuspended: i === 3, profileCompleted: true,
    })), { session });
    await chatCollection(db, "artisanprofiles").insertOne({ _id: ids.artisanprofiles[0], ...synthetic, ...times, user: professional,
      category: "Electrician", skills: ["Synthetic electrical work"] }, { session });
    await chatCollection(db, "bookings").insertMany(ids.bookings.map((_id, i) => ({ _id, ...synthetic, ...times,
      client: customer, artisan: ids.artisanprofiles[0], service: "Synthetic repair", date: now, time: "09:00",
      address: "Synthetic test address", status: "accepted", conversation: ids.conversations[i] ?? null,
    })), { session });
    await chatCollection(db, "conversations").insertMany(ids.conversations.map((_id, i) => ({ _id, ...synthetic, ...times,
      booking: ids.bookings[i], client: customer, artisan: professional, participants: [customer, professional],
      status: i === 0 ? "active" : "closed", lastMessage: i === 0 ? ids.messages.at(-1) : null,
      lastMessageAt: i === 0 ? now : null, clientUnreadCount: i === 0 ? 2 : 0, artisanUnreadCount: i === 0 ? 2 : 0,
    })), { session });
    await chatCollection(db, "messages").insertMany(ids.messages.map((_id, i) => ({ _id, ...synthetic, ...times,
      conversation: ids.conversations[0], booking: ids.bookings[0], sender: i % 2 ? professional : customer,
      recipient: i % 2 ? customer : professional, text: "Synthetic message " + (i + 1),
      type: "text", read: i < 32, readAt: i < 32 ? now : null,
    })), { session });
  }));
}

async function cleanup(db, client) {
  await client.withSession(session => session.withTransaction(async () => {
    await checkFixtureScope(db, session);
    for (const name of [...collectionNames].reverse()) await chatCollection(db, name).deleteMany(synthetic, { session });
  }));
}

async function main(mode, env) {
  if (!["prepare", "seed", "cleanup"].includes(mode)) throw new Error("Select prepare, seed, or cleanup.");
  const { uri } = readConfig(env);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const db = (await client.connect()).db();
    await verifyDatabase(db);
    await verifyTransactions(client, db);
    if (mode === "prepare") await prepare(db);
    else {
      await verifyIndexes(db);
      if (mode === "seed") await seed(db, client, env.MARKETPLACE_FIXTURE_PASSWORD);
      else await cleanup(db, client);
    }
  } finally { await client.close(); }
}

if (require.main === module) {
  main(process.argv[2], process.env).then(() => console.log("Marketplace staging fixture operation completed."))
    .catch(() => { console.error("Marketplace staging fixture operation failed."); process.exitCode = 1; });
}
module.exports = { ids, prepare, seed, cleanup };
