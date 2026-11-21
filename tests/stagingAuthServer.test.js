const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { readStagingConfig } = require("../src/config/stagingAuth");
const { createApp } = require("../src/stagingAuthApp");
const { startStagingAuth } = require("../server.staging-auth");

const staging = {
  STAGING_AUTH_MODE: "staging",
  MONGO_URI: "mongodb+srv://demandpoint_staging_user:fixture@cluster0.example.invalid/demandpoint-staging?authSource=admin",
  JWT_SECRET: "fixture-only-staging-secret-for-tests",
  GOOGLE_CLIENT_ID: "fixture-web-client.apps.googleusercontent.com",
  PORT: "10000",
};

test("staging config requires explicit mode, secrets, audience and Render port", () => {
  assert.equal(readStagingConfig(staging).port, 10000);
  for (const key of Object.keys(staging)) {
    assert.throws(() => readStagingConfig({ ...staging, [key]: undefined }), { message: new RegExp(key) });
  }
  assert.throws(() => readStagingConfig({ ...staging, JWT_SECRET: "short" }), /JWT_SECRET/);
  assert.throws(() => readStagingConfig({ ...staging, GOOGLE_CLIENT_ID: "invalid" }), /GOOGLE_CLIENT_ID/);
});

test("production, missing or ambiguous database selection and wrong connection identity are rejected", () => {
  for (const uri of [
    staging.MONGO_URI.replace("/demandpoint-staging", "/marketplace"),
    staging.MONGO_URI.replace("/demandpoint-staging", "/"),
    staging.MONGO_URI + "&%64bName=marketplace",
    staging.MONGO_URI.replace("demandpoint_staging_user", "another-user"),
    staging.MONGO_URI.replace(":fixture@", "@"),
    staging.MONGO_URI + "&tls=false",
    staging.MONGO_URI + "&tlsAllowInvalidHostnames=true",
  ]) {
    assert.throws(() => readStagingConfig({ ...staging, MONGO_URI: uri }), /MONGO_URI/);
  }
});

test("staging app exposes only health and the three auth endpoints, with safe hydration", () => {
  const handler = () => {};
  const app = createApp({ googleLogin: handler, googleLink: handler, protect: handler });
  const routes = app.router.stack.filter(layer => layer.route).map(layer => layer.route);
  assert.deepEqual(routes.map(route => [route.path, Object.keys(route.methods)]), [
    ["/", ["get"]],
    ["/api/auth/google", ["post"]],
    ["/api/auth/google/link", ["post"]],
    ["/api/users/me", ["get"]],
  ]);

  const me = routes.at(-1);
  assert.equal(me.stack[0].handle, handler);
  const req = { user: { _id: "id", name: "Fixture", role: "artisan", password: "hash", verificationCode: "code", googleId: "subject" } };
  let response;
  me.stack[1].handle(req, { json: body => { response = body; } });
  assert.equal(response.role, "artisan");
  for (const key of ["password", "verificationCode", "googleId", "subscription"]) {
    assert.equal(Object.hasOwn(response, key), false);
  }
});

function startupFixture({ databaseName = "demandpoint-staging", privilegeDb = databaseName } = {}) {
  const calls = [];
  const identity = {
    authenticatedUsers: [{ user: "demandpoint_staging_user" }],
    authenticatedUserRoles: [{ role: "readWrite", db: databaseName }],
    authenticatedUserPrivileges: [{ resource: { db: privilegeDb, collection: "" } }],
  };
  const mongoose = {
    set(options) { calls.push(["set", options]); },
    async connect(_uri, options) { calls.push(["connect", options]); },
    async disconnect() { calls.push("disconnect"); },
    connection: {
      db: {
        databaseName,
        async command(command) { calls.push(command); return { authInfo: identity }; },
      },
    },
  };
  const makeApp = () => {
    calls.push("app");
    return {
      listen(port, host) {
        calls.push(["listen", port, host]);
        const server = new EventEmitter();
        server.close = done => { calls.push("close"); done?.(); };
        queueMicrotask(() => server.emit("listening"));
        return server;
      },
    };
  };
  return { calls, mongoose, makeApp };
}

test("unsafe configuration fails before model initialization or connection", async () => {
  const fixture = startupFixture();
  await assert.rejects(startStagingAuth({}, fixture), /STAGING_AUTH_MODE/);
  assert.deepEqual(fixture.calls, []);
});

test("unexpected effective database or privileges fail closed and disconnect", async () => {
  for (const options of [{ databaseName: "marketplace" }, { privilegeDb: "marketplace" }]) {
    const fixture = startupFixture(options);
    await assert.rejects(startStagingAuth(staging, fixture), /startup failed/);
    assert.equal(fixture.calls.includes("app"), false);
    assert.equal(fixture.calls.at(-1), "disconnect");
  }
});

test("startup disables schema writes before connecting and verified shutdown closes once", async () => {
  const fixture = startupFixture();
  const running = await startStagingAuth(staging, fixture);
  const schema = { autoIndex: false, autoCreate: false };
  assert.deepEqual(fixture.calls, [
    ["set", schema],
    ["connect", { ...schema, serverSelectionTimeoutMS: 12000 }],
    { connectionStatus: 1, showPrivileges: true },
    "app",
    ["listen", 10000, "0.0.0.0"],
  ]);
  await Promise.all([running.close(), running.close()]);
  assert.deepEqual(fixture.calls.slice(-2), ["close", "disconnect"]);
});

test("building the real auth app imports no production entry point or external service configuration", () => {
  const mongoose = require("mongoose");
  mongoose.set({ autoIndex: false, autoCreate: false });
  require("../src/stagingAuthApp").createStagingAuthApp(readStagingConfig(staging));
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const forbidden = [
    "server.js", "src/config/resend.js", "src/config/cloudinary.js",
    "src/services/subscriptionMaintenanceScheduler.js", "src/services/paystackService.js",
  ];
  for (const file of forbidden) assert.equal(require.cache[path.join(root, file)], undefined);
  assert.equal(mongoose.connection.readyState, 0);
});

test("the staging JWT verifies through the real hydration middleware and a different signer is rejected", async t => {
  const jwt = require("jsonwebtoken");
  const User = require("../src/models/User");
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = staging.JWT_SECRET;
  t.after(() => {
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  const account = { _id: "fixture-id", name: "Test account", isSuspended: false };
  const findById = t.mock.method(User, "findById", () => ({ select: async () => account }));
  const app = require("../src/stagingAuthApp").createStagingAuthApp(readStagingConfig(staging));
  const me = app.router.stack.find(layer => layer.route?.path === "/api/users/me").route.stack;
  const protect = me[0].handle;
  const hydrate = me[1].handle;

  async function run(token) {
    const req = { headers: { authorization: "Bearer " + token } };
    let status = 200;
    let body;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
    await protect(req, res, () => hydrate(req, res));
    return { status, body };
  }
  const token = jwt.sign({ id: account._id }, staging.JWT_SECRET, { expiresIn: "7d" });
  assert.equal((await run(token)).body.name, account.name);
  assert.equal((await run(jwt.sign({ id: account._id }, "alternate-fixture-secret"))).status, 401);
  assert.equal(findById.mock.callCount(), 1);
  account.isSuspended = true;
  assert.equal((await run(token)).status, 403);
});
