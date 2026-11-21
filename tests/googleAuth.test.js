const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createGoogleLogin, hasGoogleSubjectIndex } = require("../src/controllers/googleAuthController");

const audience = "configured-web-client";
const goodIndexes = [
  { key: { email: 1 }, unique: true },
  { key: { googleId: 1 }, unique: true, partialFilterExpression: { googleId: { $type: "string" } } },
];

function harness({ rows = [], indexes = goodIndexes, configuredAudience = audience, googleClient } = {}) {
  const notifications = [];
  const calls = { verify: 0, lookup: 0, create: 0, issue: [] };
  const defaultPayload = {
    aud: audience, iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 3600,
    sub: "subject-a", email: "new@gmail.com", email_verified: true,
  };
  const User = {
    find: ({ googleId }) => ({ collation: () => ({ limit: async limit => {
      calls.lookup++;
      return rows.filter(row => row.googleId === googleId).slice(0, limit);
    } }) }),
    exists: ({ email }) => ({ collation: async () =>
      rows.some(row => typeof email === "string" ? row.email === email : email.test(row.email)) }),
    listIndexes: async () => indexes,
    create: async fields => {
      calls.create++;
      if (rows.some(row => row.email === fields.email || row.googleId === fields.googleId)) {
        throw Object.assign(new Error("fixture duplicate"), { code: 11000 });
      }
      const user = { _id: "fixture-" + (rows.length + 1), role: null, profileCompleted: false, ...fields };
      rows.push(user);
      return user;
    },
  };
  const mockedGoogleClient = {
    verifyIdToken: async ({ idToken, audience: actualAudience }) => {
      calls.verify++;
      assert.equal(actualAudience, audience);
      if (idToken === "invalid") throw new Error("fixture verification failed");
      const payload = { ...defaultPayload, ...JSON.parse(idToken) };
      return { getPayload: () => payload };
    },
  };
  const handler = createGoogleLogin({
    User, googleClient: googleClient ?? mockedGoogleClient, getAudience: () => configuredAudience,
    generateToken: id => { calls.issue.push(id); return "jwt-for-" + id; },
    buildSafeUser: ({ password, ...user }) => user,
    onNewUser: async user => { notifications.push(user._id); },
  });
  async function send(overrides = {}, credential = JSON.stringify(overrides)) {
    const reply = {
      statusCode: 0, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    return handler({ body: { credential } }, reply);
  }
  return { calls, rows, send, notifications, User };
}

test("returning linked users keep the same ID and account state when the Google email changes", async () => {
  const legacy = {
    _id: "existing", googleId: "subject-a", email: "old@gmail.com", role: "artisan", password: "fixture-hash",
    profileCompleted: true, profileImage: "existing-photo", isVerified: false,
  };
  const other = { _id: "different", email: "new@gmail.com", googleId: "subject-b" };
  const h = harness({ rows: [legacy, other], indexes: [] });
  const reply = await h.send();
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.body, {
    success: true, token: "jwt-for-existing",
    user: {
      _id: "existing", googleId: "subject-a", email: "old@gmail.com", role: "artisan",
      profileCompleted: true, profileImage: "existing-photo", isVerified: false,
    },
  });
  assert.equal(legacy.password, "fixture-hash");
  assert.equal(other.googleId, "subject-b");
  assert.equal(h.calls.create, 0);
  assert.deepEqual(h.notifications, []);
});

test("matching emails require explicit linking and do not write or overwrite any subject", async () => {
  for (const googleId of [null, "subject-b"]) {
    const existing = { _id: "local", email: "new@gmail.com", googleId, isVerified: true, password: "fixture-hash" };
    const h = harness({ rows: [existing] });
    const reply = await h.send();
    assert.equal(reply.statusCode, 409);
    assert.equal(reply.body.code, "GOOGLE_LINK_REQUIRED");
    assert.equal(reply.body.token, undefined);
    assert.equal(reply.body.user, undefined);
    assert.equal(existing.googleId, googleId);
    assert.equal(existing.password, "fixture-hash");
    assert.equal(h.calls.create, 0);
    assert.deepEqual(h.calls.issue, []);
  }
});

test("a legacy email with mixed case cannot create another account", async () => {
  const h = harness({ rows: [{ _id: "legacy", email: " New@GMAIL.COM " }] });
  assert.equal((await h.send()).body.code, "GOOGLE_LINK_REQUIRED");
  assert.equal(h.calls.create, 0);
});

test("suspended and ambiguous legacy Google identities cannot sign in", async () => {
  const user = { _id: "suspended", googleId: "subject-a", email: "new@gmail.com", isSuspended: true };
  let h = harness({ rows: [user] });
  let reply = await h.send();
  assert.equal(reply.statusCode, 403);
  assert.equal(reply.body.code, "GOOGLE_ACCOUNT_SUSPENDED");
  assert.deepEqual(h.calls.issue, []);

  h = harness({ rows: [user, { ...user, _id: "duplicate" }] });
  reply = await h.send();
  assert.equal(reply.statusCode, 409);
  assert.equal(reply.body.code, "GOOGLE_IDENTITY_CONFLICT");
  assert.deepEqual(h.calls.issue, []);
});

test("new accounts require authoritative email and both actual unique database indexes", async () => {
  let h = harness();
  let reply = await h.send({ email: "developer@example.invalid" });
  assert.equal(reply.statusCode, 403);
  assert.equal(reply.body.code, "GOOGLE_EMAIL_VERIFICATION_REQUIRED");
  assert.equal(h.calls.create, 0);

  for (const indexes of [
    [], [goodIndexes[0]], [goodIndexes[1]],
    [goodIndexes[0], { ...goodIndexes[1], unique: false }],
    [goodIndexes[0], { ...goodIndexes[1], partialFilterExpression: { googleId: { $type: "string" }, provider: "google" } }],
  ]) {
    h = harness({ indexes });
    reply = await h.send();
    assert.equal(reply.statusCode, 503);
    assert.equal(h.calls.create, 0);
  }

  h = harness();
  reply = await h.send({ email: " WORK@example.invalid ", hd: "example.invalid" });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body.user.isVerified, true);
  assert.equal(reply.body.user.email, "work@example.invalid");
  assert.equal(reply.body.user.role, null);
  assert.equal(reply.body.user.profileCompleted, false);
  assert.equal(h.notifications.length, 1);
});

test("concurrent callbacks for one subject return the same ID even with different verified email claims", async () => {
  const h = harness();
  const results = await Promise.all([h.send(), h.send({ email: "changed@gmail.com" })]);
  assert.equal(h.calls.create, 2);
  assert.ok(results.every(reply => reply.statusCode === 200));
  assert.equal(results[0].body.user._id, results[1].body.user._id);
  assert.equal(h.rows.length, 1);
  assert.equal(h.notifications.length, 1);
});

test("concurrent callbacks for different subjects sharing one email do not link or create a duplicate", async () => {
  const h = harness();
  const results = await Promise.all([h.send(), h.send({ sub: "subject-b", email: "NEW@gmail.com" })]);
  assert.equal(h.calls.create, 2);
  const success = results.find(reply => reply.statusCode === 200);
  const rejected = results.find(reply => reply.statusCode === 409);
  assert.ok(success);
  assert.equal(rejected.body.code, "GOOGLE_LINK_REQUIRED");
  assert.equal(rejected.body.token, undefined);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].googleId, success.body.user.googleId);
  assert.equal(h.calls.issue.length, 1);
});

test("missing config, invalid credentials and invalid claims fail before any account reads", async () => {
  const unconfigured = harness({ configuredAudience: "  " });
  assert.equal((await unconfigured.send()).statusCode, 503);
  assert.equal(unconfigured.calls.verify, 0);
  const h = harness();
  assert.equal((await h.send({}, {})).statusCode, 400);
  assert.equal((await h.send({}, "invalid")).statusCode, 401);
  for (const overrides of [
    { aud: "wrong" }, { iss: "https://invalid.example" }, { exp: 0 },
    { exp: "9999999999" }, { email_verified: false }, { email_verified: "true" },
    { sub: "" }, { sub: " subject-a " }, { email: "invalid" },
  ]) {
    assert.equal((await h.send(overrides)).statusCode, 401);
  }
  assert.equal(h.calls.lookup, 0);
  assert.deepEqual(h.calls.issue, []);
});

test("a subject created between subject and email reads resolves to the winning account", async () => {
  const h = harness();
  const exists = h.User.exists;
  h.User.exists = (selector) => {
    h.rows.push({ _id: "concurrent", googleId: "subject-a", email: "new@gmail.com" });
    return exists(selector);
  };
  const reply = await h.send();
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body.user._id, "concurrent");
  assert.equal(h.calls.create, 0);
});

test("the installed staging index definitions match the schema and Google readiness checks", async () => {
  const User = require("../src/models/User");
  const indexes = User.schema.indexes();
  const emailIndexes = indexes.filter(([key]) => Object.hasOwn(key, "email"));
  assert.equal(emailIndexes.length, 1);
  const [[emailKey, emailOptions]] = emailIndexes;
  assert.deepEqual(emailKey, { email: 1 });
  assert.equal(emailOptions.unique, true);
  assert.ok(!emailOptions.name || emailOptions.name === "email_1");
  assert.ok(!emailOptions.sparse && !emailOptions.partialFilterExpression);
  assert.ok(!emailOptions.collation || emailOptions.collation.locale === "simple");
  assert.equal(User.schema.path("googleId").instance, "String");
  assert.equal(User.schema.path("googleId").options.default, null);
  assert.ok(indexes.every(([key]) => !Object.hasOwn(key, "googleId")));

  const stagingIndexes = [
    { name: "email_1", key: { email: 1 }, unique: true },
    {
      name: "users_googleId_unique_string", key: { googleId: 1 }, unique: true,
      partialFilterExpression: { googleId: { $type: "string" } }, collation: { locale: "simple" },
    },
  ];
  assert.equal(hasGoogleSubjectIndex(stagingIndexes), true);
  assert.equal(hasGoogleSubjectIndex([{
    ...stagingIndexes[1], collation: { locale: "en", strength: 2 },
  }]), false);

  const h = harness({ indexes: stagingIndexes });
  assert.equal((await h.send()).statusCode, 200);
  assert.equal(h.calls.create, 1);
});

test("Google library verifies a signed fixture offline and rejects a tampered signature before accounts are read", async () => {
  const { generateKeyPairSync } = require("node:crypto");
  const { OAuth2Client } = require("google-auth-library");
  const jwt = require("jsonwebtoken");

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = "offline-fixture-key";
  const googleClient = new OAuth2Client();
  googleClient.getFederatedSignonCertsAsync = async () => ({
    certs: { [keyId]: publicKey.export({ type: "spki", format: "pem" }) },
  });

  const credential = jwt.sign({ email: "fixture@gmail.com", email_verified: true }, privateKey, {
    algorithm: "RS256", keyid: keyId, subject: "subject-a", audience,
    issuer: "https://accounts.google.com", expiresIn: "5m",
  });
  const h = harness({ googleClient, rows: [{ _id: "existing", googleId: "subject-a", email: "fixture@gmail.com" }] });
  assert.equal((await h.send({}, credential)).statusCode, 200);

  const [header, payload, encodedSignature] = credential.split(".");
  const signature = Buffer.from(encodedSignature, "base64url");
  signature[0] ^= 1;
  const tampered = [header, payload, signature.toString("base64url")].join(".");
  const rejected = await h.send({}, tampered);
  assert.equal(rejected.statusCode, 401);
  assert.equal(rejected.body.code, "GOOGLE_INVALID_CREDENTIAL");
  assert.equal(h.calls.lookup, 1);
  assert.deepEqual(h.calls.issue, ["existing"]);
  assert.equal(h.calls.create, 0);
});
