const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { DATABASE } = require("../src/config/marketplaceStaging");
const { ids } = require("./marketplaceStagingFixtures");

const expected = "https://marketplace-integration-staging.onrender.com";

async function check(env) {
  if (env.MARKETPLACE_STAGING_MODE !== "staging" ||
      env.MARKETPLACE_STAGING_TEST_ORIGIN !== expected ||
      !env.MARKETPLACE_FIXTURE_PASSWORD ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Explicit staging configuration required.");

  let step = "health";
  async function request(path, { token, body, method = "GET", status = 200 } = {}) {
    const response = await fetch(expected + path, { method, redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: JSON.stringify(body) });
    if (response.status !== status) throw new Error(step + " returned HTTP " + response.status);
    return response.json();
  }
  const health = await request("/");
  assert.equal(health.service, "demandpoint-marketplace-integration-staging");
  assert.equal(health.database, DATABASE);
  assert.equal(health.status, "ok");
  step = "synthetic login and hydration";
  async function login(role, status = 200, password = env.MARKETPLACE_FIXTURE_PASSWORD) {
    return request("/api/auth/login", { method: "POST", status, body: { email: "chat-" + role + "@demandpoint.test", password } });
  }
  const client = (await login("client")).token;
  const artisan = (await login("artisan")).token;
  const other = (await login("unrelated")).token;
  await login("suspended", 401);
  await login("client", 401, randomUUID());
  for (const [token, role] of [[client, "client"], [artisan, "artisan"]]) {
    assert.equal((await request("/api/users/me", { token })).role, role);
  }
  await request("/api/users/me", { token: "invalid-token", status: 401 });
  await request("/api/auth/google", { method: "POST", status: 404 });
  step = "participant detail and booking uniqueness";
  const base = "/api/messages";
  const thread = base + "/conversations/" + ids.conversations[0];
  const history = thread + "/messages";
  for (const token of [client, artisan]) {
    assert.equal((await request(base + "/conversations", { token })).conversations.length, 2);
    const { conversation } = await request(thread, { token });
    assert.equal(conversation.booking.address, undefined);
    assert.equal(conversation.client.email, undefined);
  }
  await request(thread, { token: other, status: 403 });
  await request(history, { token: other, status: 403 });
  await request(base + "/conversations/invalid", { token: client, status: 400 });
  const booking = base + "/bookings/" + ids.bookings[2] + "/conversation";
  await request(booking, { token: other, method: "POST", status: 403 });
  const opened = await Promise.all([client, artisan].map(token => request(booking, { token, method: "POST" })));
  assert.equal(opened[0].conversation._id, opened[1].conversation._id);
  assert.equal((await request(booking, { token: artisan, method: "POST" })).conversation._id, opened[0].conversation._id);
  await request(base + "/bookings/00000000000000000000ffff/conversation", { token: client, method: "POST", status: 404 });

  step = "pagination and idempotent simultaneous sends";
  const first = await request(history + "?page=1&limit=30", { token: client });
  const second = await request(history + "?page=2&limit=30", { token: client });
  assert.equal(first.messages.length, 30);
  assert.equal(second.messages.length, 6);
  assert.ok(second.messages.at(-1)._id < first.messages[0]._id);
  await request(history + "?before=bad", { token: client, status: 400 });
  const mutation = { text: "Synthetic concurrency check", clientMutationId: randomUUID() };
  const send = (token, body, status = 201) => request(history, { token, body, method: "POST", status });
  const responses = await Promise.all([0, 1].map(async () => {
    const response = await fetch(expected + history, { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: "Bearer " + client, "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
    assert.ok([200, 201].includes(response.status));
    return { status: response.status, ...(await response.json()) };
  }));
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 201]);
  assert.equal(responses[0].message._id, responses[1].message._id);
  assert.equal((await send(client, mutation, 200)).replayed, true);
  assert.equal((await send(client, { ...mutation, text: "Different synthetic content" }, 409)).code, "MUTATION_CONFLICT");
  const older = await request(history + "?before=" + first.pagination.nextCursor, { token: client });
  assert.deepEqual(older.messages.map(row => row._id), second.messages.map(row => row._id));

  step = "read boundary and concurrent incoming message";
  const latest = responses[0].message._id;
  const [next] = await Promise.all([
    send(client, { text: "Synthetic unread after boundary", clientMutationId: randomUUID() }),
    request(thread + "/read", { method: "PATCH", token: artisan, body: { throughMessageId: latest } }),
  ]);
  const count = await request(base + "/unread-count", { token: artisan });
  assert.equal(count.unreadCount, 1);
  const remaining = await request(history + "?limit=2", { token: artisan });
  assert.equal(remaining.messages.find(row => row._id === next.message._id).read, false);
  await send(artisan, { text: "Synthetic artisan reply", clientMutationId: randomUUID() });
  await request(base + "/conversations/" + ids.conversations[1] + "/messages",
    { token: client, method: "POST", body: { text: "Synthetic closed-thread attempt" }, status: 409 });
}

if (require.main === module) {
  check(process.env).then(() => console.log("Marketplace staging HTTPS smoke checks passed."))
    .catch(() => { console.error("Marketplace staging HTTPS smoke checks failed. Service, credentials, or a contract assertion could not be verified."); process.exitCode = 1; });
}
