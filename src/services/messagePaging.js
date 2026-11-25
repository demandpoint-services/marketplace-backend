const { ObjectId } = require("mongodb");

function invalidCursor() {
  return Object.assign(new Error("Invalid history cursor."), { status: 400, code: "INVALID_CURSOR" });
}
function parseBoundary(before, page) {
  let boundary;
  if (before !== undefined) {
    if (page !== undefined || typeof before !== "string" || !/^[\w-]{1,100}$/.test(before)) throw invalidCursor();
    const decoded = Buffer.from(before, "base64url").toString("utf8");
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([a-f0-9]{24})$/.exec(decoded);
    if (!match || Number.isNaN(Date.parse(match[1])) || new Date(match[1]).toISOString() !== match[1] ||
        Buffer.from(decoded).toString("base64url") !== before) throw invalidCursor();
    boundary = { createdAt: new Date(match[1]), _id: new ObjectId(match[2]) };
  }
  return boundary;
}
function cursorFor(row) {
  return Buffer.from(row.createdAt.toISOString() + "|" + row._id).toString("base64url");
}
module.exports = { parseBoundary, cursorFor };
