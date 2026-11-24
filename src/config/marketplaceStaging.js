const { MongoClient } = require("mongodb");
const DATABASE = "demandpoint-staging";
const USER = "demandpoint_staging_user";

function readConfig(env) {
  if (env.MARKETPLACE_STAGING_MODE !== "staging") throw new Error("Explicit marketplace staging mode is required.");
  if (Object.keys(env).some(key => env[key] && /^(?:GOOGLE_|STAGING_AUTH_|PAYSTACK_|CLOUDINARY_|RESEND_|SMTP_|TWILIO_|FIREBASE_|STRIPE_|SENTRY_|EMAIL_|SMS_|PUSH_|ANALYTICS_|EXPO_ACCESS_TOKEN)/i.test(key))) {
    throw new Error("Unrelated integration configuration is forbidden.");
  }
  const uri = env.MONGO_URI;
  const match = /^mongodb(?:\+srv)?:\/\/[^/?#]+\/demandpoint-staging(?:\?([^#]*))?$/.exec(uri ?? "");
  if (!match || [...new URLSearchParams(match[1]).keys()].some(key => /^(dbname|tlsinsecure|tlsallowinvalidcertificates|tlsallowinvalidhostnames)$/i.test(key))) {
    throw new Error("Explicit marketplace staging URI and verified TLS are required.");
  }
  let options;
  try { options = new MongoClient(uri).options; } catch { throw new Error("Invalid marketplace staging URI."); }
  if (options.dbName !== DATABASE || options.credentials?.username !== USER || !options.credentials.password ||
      !["admin", DATABASE].includes(options.credentials.source) || !options.tls ||
      options.tlsInsecure || options.tlsAllowInvalidCertificates || options.tlsAllowInvalidHostnames ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Unsafe marketplace staging database configuration.");
  const secret = env.MARKETPLACE_STAGING_JWT_SECRET;
  if (!secret || secret === env.JWT_SECRET || secret !== secret.trim() || Buffer.byteLength(secret) < 32) throw new Error("A dedicated MARKETPLACE_STAGING_JWT_SECRET of at least 32 bytes is required.");
  const port = Number(env.PORT);
  if (!/^\d+$/.test(env.PORT ?? "") || port < 1 || port > 65535) throw new Error("A valid PORT is required.");
  return { uri, secret, port };
}

async function verifyDatabase(db) {
  if (db.databaseName !== DATABASE) throw new Error("Unexpected effective database.");
  const { authInfo } = await db.command({ connectionStatus: 1, showPrivileges: true });
  const { authenticatedUsers: users, authenticatedUserRoles: roles, authenticatedUserPrivileges: privileges } = authInfo ?? {};
  if (users?.length !== 1 || users[0].user !== USER || !["admin", DATABASE].includes(users[0].db) ||
      roles?.length !== 1 || roles[0].db !== DATABASE || roles[0].role !== "readWrite" ||
      !privileges?.length || !privileges.every(({ resource }) =>
        resource?.db === DATABASE && !resource.anyResource && !resource.cluster)) {
    throw new Error("Database privileges are not restricted to marketplace staging.");
  }
}

async function verifyTransactions(client, db) {
  // A read in a transaction verifies server support even before the fixture collections exist.
  await client.withSession(session => session.withTransaction(async () => {
    await db.collection("marketplace_chat_users").findOne(
      { _id: null }, { projection: { _id: 1 }, session },
    );
  }));
}

module.exports = { DATABASE, USER, readConfig, verifyDatabase, verifyTransactions };
