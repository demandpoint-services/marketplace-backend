const { isDeepStrictEqual } = require("node:util");

const definitions = {
  bookings: { name: "service_booking_mutation", key: { client: 1, clientMutationId: 1 } },
  messages: { name: "message_mutation_unique", key: { conversation: 1, sender: 1, clientMutationId: 1 } },
};
const partial = { clientMutationId: { $type: "string" } };
const checked = new WeakMap();

async function mutationIndexReady(collection, name) {
  const definition = definitions[name];
  const indexes = await collection.listIndexes().toArray();
  return indexes.some(index =>
    index.unique === true && !index.sparse && (!index.collation || index.collation.locale === "simple") &&
    isDeepStrictEqual(Object.entries(index.key), Object.entries(definition.key)) &&
    isDeepStrictEqual(index.partialFilterExpression, partial));
}

async function requireMutationIndex(collection, name) {
  if (checked.get(collection) === true) return;
  if (!await mutationIndexReady(collection, name)) {
    throw Object.assign(new Error("Idempotent marketplace writes are unavailable."), { status: 503, code: "MUTATION_INDEX_REQUIRED" });
  }
  checked.set(collection, true);
}

module.exports = { definitions, partial, mutationIndexReady, requireMutationIndex };
