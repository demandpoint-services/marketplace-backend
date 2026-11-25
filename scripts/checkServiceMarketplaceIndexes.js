const { MongoClient } = require("mongodb");
const { definitions, partial, mutationIndexReady } = require("../src/services/marketplaceContractIndexes");

async function inspect(db) {
  const result = {};
  for (const [name, { key }] of Object.entries(definitions)) {
    const collection = db.collection(name);
    const duplicate = await collection.aggregate([
      { $match: partial },
      { $group: { _id: Object.fromEntries(Object.keys(key).map(field => [field, "$" + field])), count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    result[name] = { duplicate, ready: await mutationIndexReady(collection, name) };
  }
  const conversations = db.collection("conversations");
  const conversationIndex = (await conversations.listIndexes().toArray()).some(index =>
    JSON.stringify(index.key) === JSON.stringify({ booking: 1 }) && index.unique && !index.sparse && !index.partialFilterExpression);
  const duplicateConversation = await conversations.aggregate([
    { $group: { _id: "$booking", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).hasNext();
  result.conversations = { duplicate: duplicateConversation, ready: !!conversationIndex };
  return result;
}

if (require.main === module) {
  async function run() {
    const uri = process.env.MARKETPLACE_INDEX_CHECK_URI;
    if (!uri) throw new Error();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    try {
      if (!/^[^/?]+\/[^/?#]+(?:\?|$)/.test(uri.replace(/^mongodb(?:\+srv)?:\/\//, ""))) throw new Error();
      await client.connect();
      const result = await inspect(client.db());
      console.log(JSON.stringify(result));
      if (Object.values(result).some(row => row.duplicate || !row.ready)) process.exitCode = 1;
    } finally {
      await client.close();
    }
  }
  run().catch(() => { console.error("Index check could not complete."); process.exitCode = 1; });
}

module.exports = { inspect };
