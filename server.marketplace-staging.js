const { once } = require("node:events");
const { MongoClient } = require("mongodb");
const { DATABASE, readConfig, verifyDatabase, verifyTransactions } = require("./src/config/marketplaceStaging");
const { createChat, verifyIndexes, chatCollection } = require("./src/services/marketplaceStagingChat");
const { createMarketplaceStagingApp } = require("./src/marketplaceStagingApp");

async function startMarketplaceStaging(env) {
  const { uri, secret, port } = readConfig(env);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  let server;
  try {
    await client.connect();
    const db = client.db();
    await verifyDatabase(db);
    await verifyIndexes(db);
    await verifyTransactions(client, db);
    server = createMarketplaceStagingApp({ users: chatCollection(db, "users"), chat: createChat(db, client), secret,
      trustProxy: env.RENDER === "true" ? 1 : false }).listen(port, "0.0.0.0");
    await once(server, "listening");
  } catch {
    server?.close();
    await client.close().catch(() => {});
    throw new Error("Marketplace staging could not verify its database, indexes, transactions, or listener.");
  }
  let closing;
  return () => closing ??= (async () => {
    const force = setTimeout(() => server.closeAllConnections(), 10000).unref();
    try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    finally { clearTimeout(force); await client.close(); }
  })();
}

if (require.main === module) {
  startMarketplaceStaging(process.env).then(close => {
    console.log("Marketplace staging listening.");
    const shutdown = () => close().catch(() => { process.exitCode = 1; });
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { startMarketplaceStaging, DATABASE };
