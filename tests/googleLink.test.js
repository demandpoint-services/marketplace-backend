const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createGoogleLink } = require("../src/controllers/googleLinkController");

const id = "65c100000000000000000001";
const otherId = "65c100000000000000000002";
const audience = "fixture-audience";
const password = "fixture-password";
const hash = bcrypt.hashSync(password, 4);
const signingKey = "fixture-only-signing-key";
const index = {
  key: { googleId: 1 }, unique: true, partialFilterExpression: { googleId: { $type: "string" } },
};
const account = {
  _id: id, email: "user@gmail.com", googleId: null, password: hash,
  role: "artisan", profileCompleted: true, isVerified: false,
  name: "Fixture", profileImage: "fixture-image",
};

function harness(rows = [{ ...account }], indexes = [index]) {
  const calls = { verifyGoogle: 0, write: 0, update: 0, password: 0 };
  const hooks = {};
  const User = {
    findById: (id) => ({ select: () => ({ lean: async () => {
      const row = rows.find(row => row._id === id);
      return row && { ...row };
    } }) }),
    exists: ({ googleId, _id }) => ({ collation: async () =>
      rows.some(row => row.googleId === googleId && row._id !== _id.$ne) }),
    listIndexes: async () => indexes,
    findOneAndUpdate: async (query, patch, options) => {
      calls.write++;
      if (hooks.beforeWrite) await hooks.beforeWrite();
      assert.equal(options.returnDocument, "after");
      assert.deepEqual(options.collation, { locale: "simple" });
      const subject = patch.$set.googleId;
      assert.deepEqual(query.$expr, { $or: [
        { $in: [{ $type: "$googleId" }, ["missing", "null"]] },
        { $eq: ["$googleId", { $literal: subject }] },
      ] });
      const row = rows.find(row => row._id === query._id && row.email === query.email &&
        row.password === query.password && !row.isSuspended && (row.googleId == null || row.googleId === subject));
      if (!row) return null;
      if (rows.some(candidate => candidate !== row && candidate.googleId === subject)) {
        throw Object.assign(new Error("duplicate fixture"), { code: 11000 });
      }
      calls.update++;
      Object.assign(row, patch.$set);
      return { ...row };
    },
  };
  const handler = createGoogleLink({
    User,
    googleClient: {
      verifyIdToken: async ({ idToken, audience: passedAudience }) => {
        calls.verifyGoogle++;
        assert.equal(passedAudience, audience);
        if (idToken === "fixture-invalid") throw new Error("verification failure");
        const now = Math.floor(Date.now() / 1000);
        return { getPayload: () => ({
          aud: audience, iss: "https://accounts.google.com", email: "user@gmail.com", sub: "subject-a",
          email_verified: true, exp: now + 3600, iat: now, ...JSON.parse(idToken),
        }) };
      },
    },
    getAudience: () => audience,
    verifySession: token => jwt.verify(token, signingKey),
    comparePassword: (candidate, saved) => { calls.password++; return bcrypt.compare(candidate, saved); },
    buildSafeUser: ({ password, googleId, ...user }) => user,
  });

  async function send({
    target = id, expiresIn = "7d", suppliedPassword = password, credential = "{}", authorization,
  } = {}) {
    const bearer = authorization ?? "Bearer " + jwt.sign({ id: target }, signingKey, { expiresIn });
    const response = {
      statusCode: 0, body: null, headers: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      set(key, value) { this.headers[key] = value; return this; },
    };
    return handler({ get: () => bearer, body: { password: suppliedPassword, credential } }, response);
  }

  return { send, rows, calls, hooks };
}

test("links a fresh Google subject after inline password proof and preserves account fields", async () => {
  const h = harness();
  const reply = await h.send();
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.headers["Cache-Control"], "no-store");
  assert.equal(reply.body.success, true);
  assert.equal(reply.body.token, undefined);
  assert.equal(reply.body.user.password, undefined);
  assert.equal(reply.body.user.googleId, undefined);
  assert.deepEqual(h.rows[0], { ...account, googleId: "subject-a" });
  assert.equal((await h.send()).statusCode, 200);
});

test("a missing or expired session and an unproven current password cannot link", async () => {
  const h = harness();
  assert.equal((await h.send({ authorization: "" })).body.code, "GOOGLE_SESSION_EXPIRED");
  assert.equal((await h.send({ expiresIn: -1 })).body.code, "GOOGLE_SESSION_EXPIRED");
  assert.equal((await h.send({ authorization: "Bearer " + jwt.sign({ id }, signingKey) })).body.code, "GOOGLE_SESSION_EXPIRED");
  assert.equal((await h.send({ suppliedPassword: "" })).body.code, "GOOGLE_REAUTH_REQUIRED");
  assert.equal((await h.send({ suppliedPassword: "wrong" })).body.code, "GOOGLE_REAUTH_REQUIRED");
  assert.equal(h.calls.verifyGoogle, 0);
  assert.equal(h.calls.write, 0);
});

test("issuer, audience, expiry, verified claims and recent issuance are required", async () => {
  const h = harness();
  assert.equal((await h.send({ credential: "fixture-invalid" })).body.code, "GOOGLE_INVALID_CREDENTIAL");
  for (const payload of [{ aud: "different" }, { iss: "bad" }, { exp: 1 }, { email_verified: false }, { sub: "" }]) {
    assert.equal((await h.send({ credential: JSON.stringify(payload) })).body.code, "GOOGLE_INVALID_CREDENTIAL");
  }
  const now = Math.floor(Date.now() / 1000);
  for (const iat of [null, now - 301, now + 31]) {
    assert.equal((await h.send({ credential: JSON.stringify({ iat }) })).body.code, "GOOGLE_CREDENTIAL_STALE");
  }
  assert.equal(h.calls.write, 0);
});

test("a mismatched email, existing different subject or subject owned elsewhere cannot link", async () => {
  const mismatch = harness();
  assert.equal((await mismatch.send({ credential: '{"email":"other@gmail.com"}' })).body.code, "GOOGLE_IDENTITY_CONFLICT");
  assert.equal(mismatch.calls.write, 0);

  const linked = harness([{ ...account, googleId: "subject-b" }]);
  assert.equal((await linked.send()).body.code, "GOOGLE_IDENTITY_CONFLICT");
  assert.equal(linked.rows[0].googleId, "subject-b");

  const duplicate = harness([{ ...account, googleId: "subject-a" }, { ...account, _id: otherId, googleId: "subject-a" }]);
  assert.equal((await duplicate.send()).body.code, "GOOGLE_IDENTITY_CONFLICT");
  assert.equal(duplicate.calls.write, 0);
});

test("suspended and passwordless accounts cannot bypass the linking proof", async () => {
  const suspended = harness([{ ...account, isSuspended: true }]);
  assert.equal((await suspended.send()).body.code, "GOOGLE_ACCOUNT_SUSPENDED");
  assert.equal(suspended.calls.write, 0);

  const googleOnly = harness([{ ...account, password: null, provider: "google" }]);
  assert.equal((await googleOnly.send()).body.code, "GOOGLE_REAUTH_UNAVAILABLE");
  assert.equal(googleOnly.calls.write, 0);
});

test("missing subject index or database failure cannot link", async () => {
  const h = harness([{ ...account }], []);
  assert.equal((await h.send()).body.code, "GOOGLE_LINK_UNAVAILABLE");
  assert.equal(h.calls.write, 0);

  const failed = harness();
  failed.hooks.beforeWrite = () => { throw new Error("fixture driver failure"); };
  const reply = await failed.send();
  assert.equal(reply.statusCode, 503);
  assert.equal(reply.body.code, "GOOGLE_LINK_UNAVAILABLE");
  assert.doesNotMatch(reply.body.message, /driver/);
  assert.equal(failed.rows[0].googleId, null);
});

test("password changes and suspension after proof are rechecked by the atomic update", async () => {
  const passwordChanged = harness();
  passwordChanged.hooks.beforeWrite = () => { passwordChanged.rows[0].password = "new-hash"; };
  assert.equal((await passwordChanged.send()).body.code, "GOOGLE_REAUTH_REQUIRED");
  assert.equal(passwordChanged.rows[0].googleId, null);

  const suspended = harness();
  suspended.hooks.beforeWrite = () => { suspended.rows[0].isSuspended = true; };
  assert.equal((await suspended.send()).body.code, "GOOGLE_ACCOUNT_SUSPENDED");
  assert.equal(suspended.rows[0].googleId, null);
});

function waitForTwoWrites(h) {
  let waiting = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.hooks.beforeWrite = async () => {
    if (++waiting === 2) release();
    await gate;
  };
}

test("concurrent different subjects cannot overwrite the winning link on one account", async () => {
  const h = harness();
  waitForTwoWrites(h);
  const results = await Promise.all([h.send(), h.send({ credential: '{"sub":"subject-b"}' })]);
  assert.deepEqual(results.map(reply => reply.statusCode).sort(), [200, 409]);
  assert.equal(h.calls.update, 1);
  assert.ok(["subject-a", "subject-b"].includes(h.rows[0].googleId));
});

test("concurrent linking across accounts uses the unique subject index to choose one winner", async () => {
  // Legacy case variants pass the same normalized-email check but are distinct stored accounts.
  const h = harness([{ ...account }, { ...account, _id: otherId, email: "USER@gmail.com" }]);
  waitForTwoWrites(h);
  const results = await Promise.all([h.send(), h.send({ target: otherId })]);
  assert.deepEqual(results.map(reply => reply.statusCode).sort(), [200, 409]);
  assert.equal(results.find(reply => reply.statusCode === 409).body.code, "GOOGLE_IDENTITY_CONFLICT");
  assert.equal(h.calls.update, 1);
  assert.equal(h.rows.filter(row => row.googleId === "subject-a").length, 1);
});
