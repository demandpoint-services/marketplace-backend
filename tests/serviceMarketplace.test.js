const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

const { createMarketplaceStagingApp, issuer, audience, synthetic } = require("../src/marketplaceStagingApp");
const { createChat } = require("../src/services/marketplaceStagingChat");
const { createMarketplaceServices } = require("../src/services/marketplaceStagingServices");

const matches = (row, filter) => Object.entries(filter).every(([key, expected]) => {
  if (key === "$or") return expected.some(term => matches(row, term));
  const value = key.split(".").reduce((parent, field) => parent?.[field], row);
  if (expected && typeof expected === "object" && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
    if ("$in" in expected) return expected.$in.some(item => String(item) === String(value));
    if ("$lt" in expected) return value < expected.$lt;
    if ("$lte" in expected) return value <= expected.$lte;
    if ("$exists" in expected) return (value !== undefined) === expected.$exists;
    if ("$ne" in expected) return value !== expected.$ne;
  }
  return String(value) === String(expected);
});

function project(row, projection) {
  if (!projection) return { ...row };
  const keys = Object.keys(projection).filter(key => projection[key]);
  if (!keys.length) return Object.fromEntries(Object.entries(row).filter(([key]) => projection[key] !== 0));
  return Object.fromEntries(Object.entries(row).filter(([key]) => key === "_id" || keys.includes(key)));
}

function inMemoryStore() {
  const tables = new Map();
  function collection(name) {
    if (!tables.has(name)) tables.set(name, []);
    const rows = tables.get(name);
    return {
      async findOne(filter, { projection } = {}) { const row = rows.find(item => matches(item, filter)); return row && project(row, projection); },
      find(filter) {
        let found = rows.filter(row => matches(row, filter));
        return {
          project(projection) { found = found.map(row => project(row, projection)); return this; },
          sort() { found.sort((a, b) => String(b._id).localeCompare(String(a._id))); return this; },
          limit(n) { found = found.slice(0, n); return this; },
          skip(n) { found = found.slice(n); return this; },
          async toArray() { return found.map(row => ({ ...row })); },
        };
      },
      async insertOne(row) { rows.push({ _id: new ObjectId(), ...row }); },
      async distinct(key, filter) { return rows.filter(row => matches(row, filter)).map(row => row[key]); },
      async countDocuments(filter) { return rows.filter(row => matches(row, filter)).length; },
      async updateOne(filter, update) {
        const row = rows.find(item => matches(item, filter));
        if (!row) return;
        Object.assign(row, update.$set);
        for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] = (row[key] ?? 0) + value;
        for (const [key, value] of Object.entries(update.$push ?? {})) row[key] = [...(row[key] ?? []), value];
      },
      async updateMany(filter, update) {
        for (const row of rows.filter(item => matches(item, filter))) Object.assign(row, update.$set);
      },
    };
  }
  let queue = Promise.resolve();
  const mongo = { withSession: work => work({ withTransaction(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  } }) };
  return { db: { collection }, mongo };
}

test("one isolated marketplace account session completes a booking, chat, notifications and review lifecycle", async t => {
  const { db, mongo } = inMemoryStore();
  const users = db.collection("marketplace_chat_users");
  const people = ["client", "artisan", "unrelated"].map(key => ({
    ...synthetic, _id: new ObjectId(), email: "chat-" + key + "@demandpoint.test", name: key,
    role: key === "artisan" ? "artisan" : "client", isVerified: true, profileCompleted: true,
  }));
  const [customer, artisan, outside] = people;
  for (const user of people) await users.insertOne(user);
  const profile = new ObjectId();
  await db.collection("marketplace_chat_artisanprofiles").insertOne({
    ...synthetic, _id: profile, user: artisan._id, category: "Electrician", skills: ["Electrical work"],
  });
  const services = createMarketplaceServices(db, mongo);
  const chat = createChat(db, mongo, { recordServiceNotification: services.notice });
  const secret = "offline-stage-two-test-key-never-used-in-deployment";
  const server = createMarketplaceStagingApp({ users, chat, services, secret }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  async function call(path, user, method = "GET", body, status = 200) {
    const token = user && jwt.sign({ id: String(user._id) }, secret, { issuer, audience, expiresIn: "1h" });
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: "Bearer " + token }) },
      body: body && JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  assert.deepEqual(await call("/stage2"), { serviceMarketplace: true });
  const catalog = await call("/artisans");
  assert.deepEqual(catalog.map(row => row._id), [String(profile)]);
  const date = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
  const payload = { artisan: String(profile), service: "Electrical work", date, time: "12:00",
    address: "Private example booking address", notes: "Test instructions", clientMutationId: "booking-replay-test-id" };
  const created = await call("/bookings", customer, "POST", payload, 201);
  const key = created.booking._id;
  const booking = "/bookings/" + key;
  assert.equal((await call("/bookings", customer, "POST", payload)).booking._id, key);
  await call("/bookings", customer, "POST", { ...payload, notes: "Changed" }, 409);
  assert.equal((await call("/bookings", artisan)).bookings[0]._id, key);
  await call(booking, outside, "GET", undefined, 404);
  assert.equal((await call(booking, artisan)).address, payload.address);
  await call(booking + "/status", customer, "PATCH", { status: "completed" }, 409);
  assert.equal((await call("/notifications/unread-count", artisan)).unreadCount, 1);
  await call(booking + "/status", artisan, "PATCH", { status: "accepted" });
  const open = "/messages/bookings/" + key + "/conversation";
  const [one, two] = await Promise.all([call(open, customer, "POST"), call(open, artisan, "POST")]);
  assert.equal(one.conversation._id, two.conversation._id);
  assert.equal(one.conversation.booking.address, undefined);
  await call(open, outside, "POST", undefined, 403);
  const thread = "/messages/conversations/" + one.conversation._id;
  const input = { text: "Stage 2 test message", clientMutationId: "stage-two-message-id" };
  const sent = await call(thread + "/messages", customer, "POST", input, 201);
  assert.equal((await call(thread + "/messages", customer, "POST", input)).message._id, sent.message._id);
  assert.equal((await call("/notifications/unread-count", artisan)).unreadCount, 2);
  const inbox = await call("/notifications/inbox", artisan);
  assert.equal(inbox.notifications.find(row => row.type === "message_received").conversationId, one.conversation._id);
  assert.equal((await call("/notifications/inbox", outside)).notifications.length, 0);
  await call(thread + "/read", artisan, "PATCH", { throughMessageId: sent.message._id });
  assert.equal((await call("/messages/unread-count", artisan)).unreadCount, 0);
  await call("/notifications/read-all", artisan, "PATCH");
  assert.equal((await call("/notifications/unread-count", artisan)).unreadCount, 0);
  await call(booking + "/status", artisan, "PATCH", { status: "in_progress" });
  await call(booking + "/status", artisan, "PATCH", { status: "awaiting_confirmation" });
  await call(booking + "/status", customer, "PATCH", { status: "completed" });
  const review = { bookingId: key, rating: 5, comment: "Good work." };
  await call("/reviews", artisan, "POST", review, 403);
  await call("/reviews", customer, "POST", review);
  await call("/reviews", customer, "POST", review, 409);
  const publicDetail = await call("/artisans/" + profile);
  assert.equal(publicDetail.rating, 5);
  const cancelled = await call("/bookings", customer, "POST", { ...payload, clientMutationId: "booking-cancel-test-id" }, 201);
  const declined = await call("/bookings", customer, "POST", { ...payload, clientMutationId: "booking-decline-test-id" }, 201);
  assert.equal((await call("/bookings/" + cancelled.booking._id + "/status", customer, "PATCH", { status: "cancelled" })).status, "cancelled");
  assert.equal((await call("/bookings/" + declined.booking._id + "/status", artisan, "PATCH", { status: "declined" })).status, "declined");
  assert.equal(publicDetail.reviews[0].comment, review.comment);
  assert.doesNotMatch(JSON.stringify(publicDetail), /Private example booking address|demandpoint\.test/);
});
