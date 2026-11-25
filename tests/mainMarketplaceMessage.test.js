const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Conversation = require("../src/models/Conversation");
const Message = require("../src/models/Message");
const Notification = require("../src/models/Notification");
const NotificationPreference = require("../src/models/NotificationPreference");
const { definitions, partial, mutationIndexReady } = require("../src/services/marketplaceContractIndexes");
const { sendConversationMessage } = require("../src/services/messageService");

test("main message writes preserve legacy attachments and replay only matching keyed sends", async t => {
  const oid = () => new mongoose.Types.ObjectId();
  const client = { _id: oid(), name: "Client" };
  const thread = { _id: oid(), booking: oid(), client: client._id, artisan: oid(), status: "active" };
  const session = {};
  const rows = [];
  const notices = [];
  const query = value => ({ session(actual) { assert.equal(actual, session); return value; },
    populate() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
  t.mock.method(mongoose.connection, "transaction", work => work(session));
  t.mock.method(Conversation, "findById", () => query(thread));
  t.mock.method(Conversation, "findByIdAndUpdate", async (_id, update, options) => {
    assert.equal(options.session, session);
    Object.assign(thread, update.$set);
    thread.artisanUnreadCount = (thread.artisanUnreadCount ?? 0) + update.$inc.artisanUnreadCount;
  });
  t.mock.method(Message.collection, "listIndexes", () => ({ toArray: async () => [
    { key: definitions.messages.key, unique: true, partialFilterExpression: partial },
  ] }));
  t.mock.method(Message, "findOne", filter => query(rows.find(row =>
    String(row.conversation) === String(filter.conversation) && row.clientMutationId === filter.clientMutationId)));
  t.mock.method(Message, "create", async ([value], options) => {
    assert.equal(options.session, session);
    const row = new Message(value);
    rows.push(row);
    return [row];
  });
  t.mock.method(Message, "findById", id => query(rows.find(row => String(row._id) === String(id))));
  t.mock.method(NotificationPreference, "findOne", () => query(null));
  t.mock.method(Notification, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(options.session, session);
    assert.equal(filter.dedupeKey, update.$setOnInsert.dedupeKey);
    notices.push(update.$setOnInsert);
  });
  const legacy = await sendConversationMessage({ conversationId: thread._id, sender: client,
    attachments: [{ type: "image", url: "https://example.test/receipt.png" }] });
  assert.equal(legacy.message.type, "image");
  assert.equal(legacy.message.attachments.length, 1);
  assert.equal(legacy.replayed, false);
  const params = { conversationId: thread._id, sender: client, text: "Mobile booking message", clientMutationId: "offline-retry" };
  const sent = await sendConversationMessage(params);
  const replay = await sendConversationMessage(params);
  assert.equal(replay.replayed, true);
  assert.equal(String(replay.message._id), String(sent.message._id));
  await assert.rejects(sendConversationMessage({ ...params, text: "Different" }), { code: "MUTATION_CONFLICT" });
  await assert.rejects(sendConversationMessage({ ...params, sender: { _id: oid() } }), { status: 403 });
  assert.equal(rows.length, 2);
  assert.equal(notices.length, 2);
  assert.equal(thread.artisanUnreadCount, 2);
  assert.ok(rows[1].createdAt > rows[0].createdAt);
});

test("mutation writes require the partial unique key without excluding legacy records", async () => {
  const matching = { key: definitions.bookings.key, unique: true, partialFilterExpression: partial };
  const collection = index => ({ listIndexes: () => ({ toArray: async () => [index] }) });
  assert.equal(await mutationIndexReady(collection(matching), "bookings"), true);
  assert.equal(await mutationIndexReady(collection({ ...matching, unique: false }), "bookings"), false);
  assert.equal(await mutationIndexReady(collection({ ...matching, partialFilterExpression: undefined }), "bookings"), false);
});

test("main history retains numbered paging and stable cursor ordering", async t => {
  const { getConversationMessages } = require("../src/services/messageService");
  const { cursorFor } = require("../src/services/messagePaging");
  const ids = Array.from({ length: 5 }, (_, index) => new mongoose.Types.ObjectId((index + 1).toString(16).padStart(24, "0")));
  const [member, threadId, ...messageIds] = ids;
  const createdAt = new Date("2026-01-01T09:00:00Z");
  const rows = messageIds.map(_id => ({ _id, createdAt })).reverse();
  t.mock.method(Conversation, "findById", async () => ({ _id: threadId, client: member }));
  t.mock.method(Message, "countDocuments", async () => rows.length);
  t.mock.method(Message, "find", filter => {
    let result = filter.$or ? rows.filter(row => String(row._id) < String(filter.$or[1]._id.$lt)) : rows;
    return { populate() { return this; }, sort(order) { assert.deepEqual(order, { createdAt: -1, _id: -1 }); return this; },
      skip(offset) { result = result.slice(offset); return this; }, limit(limit) { return result.slice(0, limit); } };
  });
  const args = { conversationId: threadId, userId: member, limit: "2" };
  const first = await getConversationMessages(args);
  assert.deepEqual(first.messages, [rows[1], rows[0]]);
  assert.equal(first.pagination.nextCursor, cursorFor(rows[1]));
  const older = await getConversationMessages({ ...args, before: first.pagination.nextCursor });
  const legacy = await getConversationMessages({ ...args, page: "2" });
  assert.deepEqual(legacy.messages, older.messages);
  assert.deepEqual(older.messages, [rows[2]]);
  assert.equal(older.pagination.page, null);
  assert.equal(legacy.pagination.page, 2);
  await assert.rejects(getConversationMessages({ ...args, before: first.pagination.nextCursor, page: "2" }), { code: "INVALID_CURSOR" });
});
