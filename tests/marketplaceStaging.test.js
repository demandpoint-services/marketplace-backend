const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { readConfig, verifyDatabase, DATABASE, USER } = require("../src/config/marketplaceStaging");
const { createMarketplaceStagingApp, issuer, audience, limiter } = require("../src/marketplaceStagingApp");
const { pageOptions, inputMessage, objectId, indexes, verifyIndexes, createChat } = require("../src/services/marketplaceStagingChat");
const { assertConversationParticipant } = require("../src/services/messageService");

const secret = "offline-fixture-signing-key-never-used-in-deployment";
const env = { MARKETPLACE_STAGING_MODE: "staging", MONGO_URI:
  "mongodb://" + USER + ":fixture@localhost/" + DATABASE + "?tls=true",
  MARKETPLACE_STAGING_JWT_SECRET: secret, PORT: "5001" };

test("config rejects unsafe or cross-environment configuration before connecting", () => {
  assert.equal(readConfig(env).port, 5001);
  for (const change of [{ MARKETPLACE_STAGING_MODE: "" }, { MARKETPLACE_STAGING_JWT_SECRET: "short" }, { MARKETPLACE_STAGING_JWT_SECRET: "", JWT_SECRET: secret }, { JWT_SECRET: secret }, { PORT: "" },
    { PAYSTACK_SECRET_KEY: "test" }, { GOOGLE_CLIENT_ID: "test" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    ...["marketplace", "marketplace-integration-staging", ""].map(db => ({ MONGO_URI: env.MONGO_URI.replace(DATABASE, db) })),
    { MONGO_URI: env.MONGO_URI.replace(USER, "another_user") }, { MONGO_URI: env.MONGO_URI.replace("?tls=true", "") },
    { MONGO_URI: env.MONGO_URI + "&tlsAllowInvalidCertificates=false" }, { MONGO_URI: env.MONGO_URI + "&dbName=marketplace" }]) {
    assert.throws(() => readConfig({ ...env, ...change }));
  }
});

test("effective roles and index definitions are checked", async () => {
  const authInfo = { authenticatedUsers: [{ user: USER, db: "admin" }],
    authenticatedUserRoles: [{ role: "readWrite", db: DATABASE }],
    authenticatedUserPrivileges: [{ resource: { db: DATABASE, collection: "" } }] };
  const db = { databaseName: DATABASE, command: async () => ({ authInfo }),
    collection: name => ({ listIndexes: () => ({ toArray: async () => indexes[name.replace(/^marketplace_chat_/, "")] }) }) };
  await verifyDatabase(db);
  await verifyIndexes(db);
  await assert.rejects(verifyDatabase({ ...db, databaseName: "marketplace" }));
  authInfo.authenticatedUserPrivileges.push({ resource: { db: "marketplace" } });
  await assert.rejects(verifyDatabase(db));
  await assert.rejects(verifyIndexes({ collection: () => ({ listIndexes: () => ({ toArray: async () => [] }) }) }));
});

test("shared participant matcher authorizes raw and populated user IDs only", () => {
  const Person = mongoose.model("OfflineChatParticipant", new mongoose.Schema({ name: String }));
  const client = new Person({ name: "Fixture" });
  const artisan = new Person({ name: "Fixture artisan" });
  for (const thread of [{ client, artisan }, { client: client._id, artisan: artisan._id }]) {
    assert.equal(assertConversationParticipant(thread, client._id), "client");
    assert.equal(assertConversationParticipant(thread, String(artisan._id)), "artisan");
    assert.throws(() => assertConversationParticipant(thread, new mongoose.Types.ObjectId()), { status: 403 });
  }
  assert.throws(() => assertConversationParticipant({ client: null, artisan: "invalid" }, "invalid"), { status: 403 });
});

test("paging, cursors and message inputs reject malformed values", () => {
  assert.deepEqual(pageOptions({}), { number: 1, size: 30, boundary: undefined });
  const cursor = Buffer.from("2025-06-01T09:00:00.000Z|000000000000000000000009").toString("base64url");
  assert.equal(String(pageOptions({ before: cursor }).boundary._id), "000000000000000000000009");
  for (const query of [{ before: cursor, page: "1" }, { before: "garbage" }, { limit: "101" }, { page: "1.5" }, { page: ["1"] }]) {
    assert.throws(() => pageOptions(query), { status: 400 });
  }
  assert.throws(() => objectId("malformed"), { status: 400 });
  assert.deepEqual(inputMessage({ text: "  hello  ", clientMutationId: "x-1" }), { text: "hello", clientMutationId: "x-1" });
  for (const input of [{ text: "" }, { text: "x".repeat(2001) }, { text: "hi", attachments: [{}] }, { text: "hi", clientMutationId: "bad id" }]) {
    assert.throws(() => inputMessage(input), { status: 400 });
  }
});

test("local throttling expires and capacity is bounded", () => {
  let time = 0;
  const consume = limiter({ max: 2, interval: 1000, capacity: 1, clock: () => time });
  assert.equal(consume("a"), 0);
  assert.equal(consume("a"), 0);
  assert.equal(consume("a"), 1);
  assert.equal(consume("b"), 1);
  time = 1000;
  assert.equal(consume("b"), 0);
});

test("isolated login, hydration, route exposure, throttling and JWT scopes", async t => {
  const user = { _id: objectId("000000000000000000000001"), email: "chat-client@demandpoint.test", role: "client",
    password: bcrypt.hashSync("offline-test-password", 4), isVerified: true, profileCompleted: true };
  const suspended = { ...user, _id: objectId("000000000000000000000004"), email: "chat-suspended@demandpoint.test", isSuspended: true };
  const fixtureUsers = [user, suspended];
  const users = { async findOne(query) {
    assert.equal(query.marketplaceChatFixture, "stage-1b-v1");
    return fixtureUsers.find(candidate => query.email ? candidate.email === query.email : candidate._id.equals(query._id));
  } };
  const chat = { list: async () => ({ conversations: [], totalUnread: 0 }), send: async () => ({ replayed: false, message: { text: "offline" } }) };
  const server = createMarketplaceStagingApp({ users, chat, secret }).listen(0, "127.0.0.1");
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (path, token, body) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = (email, password = "offline-test-password") => call("/api/auth/login", null, { email, password });
  assert.deepEqual(await (await call("/")).json(), { service: issuer, database: DATABASE, status: "ok" });
  for (const path of ["/api/auth/register", "/api/auth/google", "/api/auth/forgot-password", "/api/payments", "/api/notifications"]) {
    assert.equal((await call(path, null, {})).status, 404);
  }
  assert.equal((await login("real@example.invalid")).status, 401);
  assert.equal((await login(suspended.email)).status, 401);
  assert.equal((await login(user.email, "wrong")).status, 401);
  const result = await (await login(user.email)).json();
  assert.ok(result.success);
  assert.equal(result.user.password, undefined);
  const token = result.token;
  assert.equal((await (await call("/api/users/me", token)).json()).email, user.email);
  assert.equal((await call("/api/messages/conversations", token)).status, 200);
  const sign = (id, options) => jwt.sign({ id: String(id) }, secret, options);
  for (const invalid of ["invalid", sign(user._id, { expiresIn: "1h" }), sign(user._id, { issuer, audience, expiresIn: "-1m" })]) {
    assert.equal((await call("/api/users/me", invalid)).status, 401);
  }
  assert.equal((await call("/api/users/me", sign(suspended._id, { issuer, audience, expiresIn: "1h" }))).status, 403);
  assert.equal((await call("/api/messages/conversations/invalid/messages", token, { text: "offline" })).status, 400);
  assert.equal((await call("/api/messages/conversations/" + user._id + "/messages", token, { text: "x".repeat(13000) })).status, 413);
  const path = "/api/messages/conversations/" + user._id + "/messages";
  for (let i = 0; i < 39; i++) assert.equal((await call(path, token, { text: "offline" })).status, 201);
  assert.equal((await call(path, token, { text: "offline" })).status, 429);
  for (let i = 0; i < 6; i++) assert.equal((await login("real@example.invalid")).status, 401);
  assert.equal((await login("real@example.invalid")).status, 429);
});

test("offline transactional simulation rolls back a partial send and commits once on replay", async () => {
  const id = n => objectId(String(n).padStart(24, "0"));
  const [threadId, booking, sender, recipient] = [1, 2, 3, 4].map(id);
  const thread = { _id: threadId, booking, client: sender, artisan: recipient, status: "active", artisanUnreadCount: 0 };
  let rows = [];
  let chain = Promise.resolve();
  const messages = {
    async findOne(filter) { return rows.find(row => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))); },
    async insertOne(row) { rows.push(row); },
  };
  const tables = {
    users: { findOne: async ({ _id }) => ({ _id, name: "Fixture" }) }, messages,
    conversations: { findOne: async () => thread, async updateOne(_filter, update) {
      Object.assign(thread, update.$set);
      thread.artisanUnreadCount += update.$inc.artisanUnreadCount;
    } },
  };
  const client = { withSession: run => run({ withTransaction(work) {
    const next = chain.then(async () => {
      const before = [...rows];
      const metadata = { ...thread };
      try { return await work(); }
      catch (error) {
        rows = before;
        for (const key of Object.keys(thread)) delete thread[key];
        Object.assign(thread, metadata);
        throw error;
      }
    });
    chain = next.catch(() => {});
    return next;
  } }) };
  let fail = true;
  const chat = createChat({ collection: name => tables[name.replace(/^marketplace_chat_/, "")] }, client, { afterMessageInsert: async () => {
    if (fail) throw new Error("offline rollback");
  } });
  const body = { text: "Synthetic text", clientMutationId: "retry-id" };
  await assert.rejects(chat.send(threadId, sender, body), /offline rollback/);
  assert.equal(rows.length, 0);
  assert.equal(thread.artisanUnreadCount, 0);
  fail = false;
  const results = await Promise.all([chat.send(threadId, sender, body), chat.send(threadId, sender, body)]);
  assert.deepEqual(results.map(result => result.replayed), [false, true]);
  assert.ok(results[0].message._id.equals(results[1].message._id));
  assert.equal(rows.length, 1);
  assert.equal(thread.artisanUnreadCount, 1);
  assert.ok(thread.lastMessage.equals(thread.lastStagingNotification.messageId));
  assert.equal(thread.lastStagingNotification.text, undefined);
  await assert.rejects(chat.send(threadId, sender, { ...body, text: "different" }), { status: 409 });
  await assert.rejects(chat.send(threadId, id(5), body), { status: 403 });
});

test("read boundary leaves newer arrivals unread and repeated reads reconcile the counter", async () => {
  const id = n => objectId(String(n).padStart(24, "0"));
  const [threadId, booking, sender, recipient, older, newer] = [1, 2, 3, 4, 5, 6].map(id);
  const now = new Date("2025-01-01T00:00:00Z");
  const thread = { _id: threadId, booking, client: sender, artisan: recipient, status: "active",
    lastMessage: newer, artisanUnreadCount: 2 };
  const rows = [
    { _id: older, conversation: threadId, recipient, createdAt: now, read: false },
    { _id: newer, conversation: threadId, recipient, createdAt: now, read: false },
  ];
  const tables = {
    users: { findOne: async ({ _id }) => ({ _id, name: "Fixture" }) },
    bookings: { findOne: async () => ({ _id: booking }) },
    conversations: {
      findOne: async () => thread,
      distinct: async () => [threadId],
      async updateOne(_filter, update) { Object.assign(thread, update.$set); },
    },
    messages: {
      findOne: async filter => rows.find(row => row._id.equals(filter._id)),
      async updateMany(filter, update) {
        assert.ok(filter.recipient.equals(recipient));
        const [earlier, tied] = filter.$or;
        for (const row of rows) {
          if (!row.read && (row.createdAt < earlier.createdAt.$lt ||
              (+row.createdAt === +tied.createdAt && String(row._id) <= String(tied._id.$lte)))) {
            Object.assign(row, update.$set);
          }
        }
      },
      countDocuments: async filter => rows.filter(row => row.recipient.equals(filter.recipient) && !row.read).length,
    },
  };
  const client = { withSession: run => run({ withTransaction: work => work() }) };
  const chat = createChat({ collection: name => tables[name.replace(/^marketplace_chat_/, "")] }, client);
  for (let i = 0; i < 2; i++) {
    const result = await chat.markRead(threadId, recipient, older);
    assert.equal(result.totalUnread, 1);
    assert.equal(result.conversation.artisanUnreadCount, 1);
  }
  assert.deepEqual(rows.map(row => row.read), [true, false]);
  assert.equal(await chat.unread(recipient), 1);
});

test("fixture preparation and cleanup stay in marketplace collections", async () => {
  const { prepare, cleanup } = require("../scripts/marketplaceStagingFixtures");
  const operations = [];
  const db = {
    async createCollection(name) { operations.push(name); },
    collection(name) {
      operations.push(name);
      return {
        async createIndexes() {},
        listIndexes: () => ({ toArray: async () => indexes[name.replace(/^marketplace_chat_/, "")] }),
        async countDocuments(filter) {
          assert.deepEqual(filter, { $nor: [{ marketplaceChatFixture: "stage-1b-v1" }] });
          return 0;
        },
        async deleteMany(filter) {
          assert.deepEqual(filter, { marketplaceChatFixture: "stage-1b-v1" });
        },
      };
    },
  };
  const client = { withSession: run => run({ withTransaction: work => work() }) };
  await prepare(db);
  await cleanup(db, client);
  assert.deepEqual([...new Set(operations)].sort(), Object.keys(indexes).map(name => "marketplace_chat_" + name).sort());
});
