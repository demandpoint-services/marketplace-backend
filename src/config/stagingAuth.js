const { MongoClient } = require("mongodb");

const DATABASE = "demandpoint-staging";
const DATABASE_USER = "demandpoint_staging_user";

function readStagingConfig(env) {
  if (env.STAGING_AUTH_MODE !== "staging") {
    throw new Error("STAGING_AUTH_MODE must explicitly select staging.");
  }

  const uri = env.MONGO_URI;
  const uriMatch = /^mongodb(?:\+srv)?:\/\/[^/?#]+\/demandpoint-staging(?:\?([^#]*))?$/.exec(uri ?? "");
  if (!uriMatch || [...new URLSearchParams(uriMatch[1]).keys()].some(key => key.toLowerCase() === "dbname")) {
    throw new Error("MONGO_URI must explicitly select demandpoint-staging without a dbName override.");
  }

  const insecureOptions = new Set(["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"]);
  if ([...new URLSearchParams(uriMatch[1]).keys()].some(key => insecureOptions.has(key.toLowerCase()))) {
    throw new Error("MONGO_URI must not override TLS verification.");
  }

  let options;
  try {
    // The driver parses the URI here. It does not connect.
    options = new MongoClient(uri).options;
  } catch {
    throw new Error("MONGO_URI is not a valid staging connection URI.");
  }
  if (options.dbName !== DATABASE || options.credentials?.username !== DATABASE_USER || !options.credentials.password ||
      !["admin", DATABASE].includes(options.credentials.source)) {
    throw new Error("MONGO_URI must use the dedicated staging database identity.");
  }

  if (!options.tls || options.tlsInsecure || options.tlsAllowInvalidCertificates ||
      options.tlsAllowInvalidHostnames || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("MONGO_URI must use TLS with certificate and hostname verification.");
  }

  const secret = env.JWT_SECRET;
  if (typeof secret !== "string" || secret !== secret.trim() || Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes and be provisioned for staging.");
  }

  const audience = env.GOOGLE_CLIENT_ID?.trim();
  if (!audience || !/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(audience)) {
    throw new Error("GOOGLE_CLIENT_ID must be an explicit Google Web OAuth client ID.");
  }

  const port = Number(env.PORT);
  if (!/^\d+$/.test(env.PORT ?? "") || port < 1 || port > 65535) {
    throw new Error("PORT must be explicitly set to a valid TCP port.");
  }

  return { uri, audience, secret, port };
}

module.exports = { DATABASE, DATABASE_USER, readStagingConfig };
