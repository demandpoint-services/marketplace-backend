const { once } = require("node:events");
const { DATABASE, DATABASE_USER, readStagingConfig } = require("./src/config/stagingAuth");

async function verifyDatabase(connection) {
  if (connection.db?.databaseName !== DATABASE) {
    throw new Error("Connected database is not the staging database.");
  }

  const { authInfo } = await connection.db.command({ connectionStatus: 1, showPrivileges: true });
  const { authenticatedUsers, authenticatedUserRoles, authenticatedUserPrivileges } = authInfo ?? {};
  if (authenticatedUsers?.length !== 1 || authenticatedUsers[0].user !== DATABASE_USER ||
      authenticatedUserRoles?.length !== 1 || authenticatedUserRoles[0].db !== DATABASE ||
      authenticatedUserRoles[0].role !== "readWrite" || !authenticatedUserPrivileges?.length ||
      !authenticatedUserPrivileges.every(({ resource }) =>
        resource?.db === DATABASE && !resource.cluster && !resource.anyResource)) {
    throw new Error("Connected database identity is not scoped to staging.");
  }
}

async function startStagingAuth(env, dependencies = {}) {
  const config = readStagingConfig(env);
  const mongoose = dependencies.mongoose ?? require("mongoose");
  const makeApp = dependencies.makeApp ?? require("./src/stagingAuthApp").createStagingAuthApp;
  const noSchemaWrites = { autoIndex: false, autoCreate: false };
  mongoose.set(noSchemaWrites);

  let server;
  try {
    await mongoose.connect(config.uri, { ...noSchemaWrites, serverSelectionTimeoutMS: 12000 });
    await verifyDatabase(mongoose.connection);
    server = makeApp(config).listen(config.port, "0.0.0.0");
    await once(server, "listening");
  } catch {
    server?.close();
    await mongoose.disconnect().catch(() => {});
    throw new Error("Staging authentication startup failed during database or listener initialization.");
  }

  let closing;
  return {
    close() {
      closing ??= (async () => {
        const timer = setTimeout(() => server.closeAllConnections(), 10000).unref();
        try {
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        } finally {
          clearTimeout(timer);
          await mongoose.disconnect();
        }
      })();
      return closing;
    },
  };
}

if (require.main === module) {
  startStagingAuth(process.env).then(({ close }) => {
    console.log("Staging authentication server listening.");
    const shutdown = () => close().catch(() => {
      console.error("Staging authentication shutdown failed.");
      process.exitCode = 1;
    });
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { startStagingAuth };
