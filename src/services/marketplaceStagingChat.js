const { ObjectId } = require("mongodb");
const { isDeepStrictEqual } = require("node:util");

const indexes = {
  users: [{ key: { email: 1 }, name: "email_1", unique: true }],
  artisanprofiles: [],
  bookings: [],
  conversations: [
    { key: { booking: 1 }, name: "chat_booking_unique", unique: true },
    { key: { client: 1, lastMessageAt: -1, updatedAt: -1, _id: -1 }, name: "chat_client_inbox" },
    { key: { artisan: 1, lastMessageAt: -1, updatedAt: -1, _id: -1 }, name: "chat_artisan_inbox" },
  ],
  messages: [
    { key: { conversation: 1, sender: 1, clientMutationId: 1 }, name: "chat_mutation_unique", unique: true,
      partialFilterExpression: { clientMutationId: { $type: "string" } } },
    { key: { conversation: 1, createdAt: -1, _id: -1 }, name: "chat_history" },
    { key: { conversation: 1, recipient: 1, read: 1 }, name: "chat_unread" },
  ],
};

function collectionName(name) {
  if (!Object.hasOwn(indexes, name)) throw new Error("Unknown marketplace chat collection.");
  return "marketplace_chat_" + name;
}

function chatCollection(db, name) {
  return db.collection(collectionName(name));
}

async function verifyIndexes(db) {
  for (const [name, definitions] of Object.entries(indexes)) {
    const actual = await chatCollection(db, name).listIndexes().toArray();
    for (const expected of definitions) {
      const index = actual.find(item => item.name === expected.name);
      if (!index || !isDeepStrictEqual(Object.entries(index.key), Object.entries(expected.key)) ||
          Boolean(index.unique) !== Boolean(expected.unique) || index.sparse ||
          (index.collation && index.collation.locale !== "simple") ||
          !isDeepStrictEqual(index.partialFilterExpression, expected.partialFilterExpression)) {
        throw new Error("Required marketplace staging indexes are missing or incompatible.");
      }
    }
  }
}

class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function failure(status, code, message) {
  return new ChatError(status, code, message);
}

function objectId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value)) throw failure(400, "INVALID_ID", "Invalid identifier.");
  return new ObjectId(value);
}

function side(conversation, user) {
  if (conversation.client?.equals(user)) return "client";
  if (conversation.artisan?.equals(user)) return "artisan";
  throw failure(403, "NOT_PARTICIPANT", "Conversation access denied.");
}

function pageOptions({ page, limit, before }) {
  function positive(value, fallback, max) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw failure(400, "INVALID_PAGING", "Invalid paging parameters.");
    }
    return Number(value);
  }
  const size = positive(limit, 30, 100);
  const number = positive(page, 1, 100000);
  let boundary;
  if (before !== undefined) {
    if (page !== undefined || typeof before !== "string" || !/^[\w-]{1,100}$/.test(before)) throw failure(400, "INVALID_CURSOR", "Invalid history cursor.");
    const decoded = Buffer.from(before, "base64url").toString("utf8");
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([a-f0-9]{24})$/.exec(decoded);
    if (!match || Number.isNaN(Date.parse(match[1])) || new Date(match[1]).toISOString() !== match[1] ||
        Buffer.from(decoded).toString("base64url") !== before) throw failure(400, "INVALID_CURSOR", "Invalid history cursor.");
    boundary = { createdAt: new Date(match[1]), _id: new ObjectId(match[2]) };
  }
  return { size, number, boundary };
}

function inputMessage({ text, clientMutationId, attachments } = {}) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value || value.length > 2000 || (attachments !== undefined && (!Array.isArray(attachments) || attachments.length))) {
    throw failure(400, "INVALID_MESSAGE", "Send a text message of 1 to 2,000 characters.");
  }
  if (clientMutationId !== undefined && (typeof clientMutationId !== "string" || !/^[\w-]{1,80}$/.test(clientMutationId))) {
    throw failure(400, "INVALID_MUTATION_ID", "Invalid client mutation identifier.");
  }
  return { text: value, clientMutationId };
}

function createChat(db, client, { afterMessageInsert = async () => {} } = {}) {
  const users = chatCollection(db, "users");
  const conversations = chatCollection(db, "conversations");
  const messages = chatCollection(db, "messages");
  const bookings = chatCollection(db, "bookings");
  const artisans = chatCollection(db, "artisanprofiles");
  const tx = work => client.withSession(session => session.withTransaction(() => work(session), {
    readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
  }));

  async function findConversation(id, user, session) {
    const row = await conversations.findOne({ _id: id }, { session });
    if (!row) throw failure(404, "NOT_FOUND", "Conversation not found.");
    side(row, user);
    return row;
  }

  async function person(id) {
    if (!id) return null;
    return users.findOne({ _id: id }, { projection: { name: 1, role: 1, profileImage: 1 } });
  }

  async function message(row) {
    if (!row) return null;
    const { _id, conversation, booking, type, text, read, readAt, createdAt, clientMutationId } = row;
    return { _id, conversation, booking, type, text, read, readAt, createdAt, clientMutationId,
      sender: await person(row.sender), recipient: await person(row.recipient) };
  }

  async function view(row) {
    const { _id, status, lastMessageAt, clientUnreadCount, artisanUnreadCount, updatedAt } = row;
    const [booking, clientUser, artisan, last] = await Promise.all([
      bookings.findOne({ _id: row.booking }, { projection: { service: 1, date: 1, time: 1, status: 1 } }),
      person(row.client), person(row.artisan), row.lastMessage ? messages.findOne({ _id: row.lastMessage }) : null,
    ]);
    return { _id, status, lastMessageAt, clientUnreadCount, artisanUnreadCount, updatedAt,
      booking, client: clientUser, artisan, lastMessage: await message(last) };
  }

  async function unread(user) {
    return messages.countDocuments({ recipient: user, read: false, conversation: {
      $in: await conversations.distinct("_id", { $or: [{ client: user }, { artisan: user }] }),
    } });
  }

  // Stage one synthetic event per conversation. This replaces the previous event
  // atomically and never invokes the production notification service.
  function recordNotification(row) {
    return { type: "message_received", messageId: row._id, recipientId: row.recipient, createdAt: row.createdAt };
  }

  async function send(id, user, body) {
    const input = inputMessage(body);
    const key = { conversation: id, sender: user, clientMutationId: input.clientMutationId };
    const replay = row => {
      if (row.text !== input.text) throw failure(409, "MUTATION_CONFLICT", "This identifier was used for a different message.");
      return { row, replayed: true };
    };
    let result;
    try {
      result = await tx(async session => {
        const thread = await findConversation(id, user, session);
        if (input.clientMutationId) {
          const existing = await messages.findOne(key, { session });
          if (existing) return replay(existing);
        }
        if (thread.status === "closed") throw failure(409, "CONVERSATION_CLOSED", "This conversation is closed.");
        const actor = side(thread, user);
        const recipient = actor === "client" ? thread.artisan : thread.client;
        if (!recipient || !await users.findOne({ _id: recipient }, { session, projection: { _id: 1 } })) {
          throw failure(409, "PARTICIPANT_UNAVAILABLE", "The other participant is unavailable.");
        }
        const now = new Date(Math.max(Date.now(), (thread.lastMessageAt?.getTime() ?? -1) + 1));
        const row = { _id: new ObjectId(), conversation: id, booking: thread.booking, sender: user, recipient,
          marketplaceChatFixture: thread.marketplaceChatFixture, text: input.text, type: "text", read: false, readAt: null, createdAt: now, updatedAt: now,
          ...(input.clientMutationId ? { clientMutationId: input.clientMutationId } : {}) };
        await messages.insertOne(row, { session });
        await afterMessageInsert();
        await conversations.updateOne({ _id: id }, {
          $set: { lastMessage: row._id, lastMessageAt: row.createdAt, updatedAt: now, lastStagingNotification: recordNotification(row) },
          $inc: { [actor === "client" ? "artisanUnreadCount" : "clientUnreadCount"]: 1 },
        }, { session });
        return { row, replayed: false };
      });
    } catch (error) {
      if (error.code !== 11000 || !input.clientMutationId) throw error;
      await findConversation(id, user);
      const existing = await messages.findOne(key);
      if (!existing) throw error;
      result = replay(existing);
    }
    return { message: await message(result.row), replayed: result.replayed };
  }

  async function markRead(id, user, throughMessageId) {
    const initial = await findConversation(id, user);
    const boundaryId = throughMessageId ?? initial.lastMessage;
    await tx(async session => {
      const thread = await findConversation(id, user, session);
      const actor = side(thread, user);
      const filter = { conversation: id, recipient: user, read: false };
      if (boundaryId) {
        const boundary = await messages.findOne({ _id: boundaryId, conversation: id }, { session });
        if (!boundary) throw failure(400, "INVALID_READ_BOUNDARY", "Message boundary is not in this conversation.");
        filter.$or = [{ createdAt: { $lt: boundary.createdAt } },
          { createdAt: boundary.createdAt, _id: { $lte: boundary._id } }];
      }
      const now = new Date();
      if (boundaryId) await messages.updateMany(filter, { $set: { read: true, readAt: now, updatedAt: now } }, { session });
      const remaining = await messages.countDocuments({ conversation: id, recipient: user, read: false }, { session });
      await conversations.updateOne({ _id: id }, { $set: { [actor + "UnreadCount"]: remaining, updatedAt: now } }, { session });
    });
    return { conversation: await view(await findConversation(id, user)), totalUnread: await unread(user) };
  }

  async function open(bookingId, user) {
    async function getOrCreate(session, canCreate) {
      const booking = await bookings.findOne({ _id: bookingId }, { session });
      if (!booking) throw failure(404, "NOT_FOUND", "Booking not found.");
      const artisan = await artisans.findOne({ _id: booking.artisan }, { session });
      if (!artisan?.user || !booking.client) throw failure(404, "NOT_FOUND", "Booking participant not found.");
      side({ client: booking.client, artisan: artisan.user }, user);
      let row = await conversations.findOne({ booking: bookingId }, { session });
      if (!row && !canCreate) throw failure(503, "RETRY_OPEN", "Conversation is not available yet.");
      if (!row) {
        const now = new Date();
        row = { _id: new ObjectId(), marketplaceChatFixture: booking.marketplaceChatFixture, booking: bookingId, client: booking.client, artisan: artisan.user,
          participants: [booking.client, artisan.user], status: "active", lastMessage: null, lastMessageAt: null,
          clientUnreadCount: 0, artisanUnreadCount: 0, createdAt: now, updatedAt: now };
        await conversations.insertOne(row, { session });
      }
      side(row, user);
      if (!booking.conversation?.equals(row._id)) {
        await bookings.updateOne({ _id: bookingId }, { $set: { conversation: row._id } }, { session });
      }
      return row;
    }
    let row;
    try { row = await tx(session => getOrCreate(session, true)); }
    catch (error) {
      if (error.code !== 11000) throw error;
      row = await tx(session => getOrCreate(session, false));
    }
    return view(row);
  }

  async function history(id, user, query) {
    await findConversation(id, user);
    const { number, size, boundary } = pageOptions(query);
    const filter = { conversation: id };
    if (boundary) filter.$or = [{ createdAt: { $lt: boundary.createdAt } },
      { createdAt: boundary.createdAt, _id: { $lt: boundary._id } }];
    const [rows, total] = await Promise.all([
      messages.find(filter).sort({ createdAt: -1, _id: -1 }).skip(boundary ? 0 : (number - 1) * size).limit(size + 1).toArray(),
      messages.countDocuments({ conversation: id }),
    ]);
    const hasMore = rows.length > size;
    const page = rows.slice(0, size);
    const oldest = page.at(-1);
    const nextCursor = hasMore ? Buffer.from(oldest.createdAt.toISOString() + "|" + oldest._id).toString("base64url") : null;
    return { messages: await Promise.all(page.reverse().map(message)),
      pagination: { page: boundary ? null : number, limit: size, total, pages: Math.max(Math.ceil(total / size), 1), hasMore, nextCursor } };
  }

  return {
    async list(user) {
      const rows = await conversations.find({ $or: [{ client: user }, { artisan: user }] })
        .sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 }).toArray();
      return { conversations: await Promise.all(rows.map(view)), totalUnread: await unread(user) };
    },
    async detail(id, user) { return view(await findConversation(id, user)); },
    unread, send, markRead, history, open,
  };
}

module.exports = { ChatError, indexes, collectionName, chatCollection, verifyIndexes, failure, objectId, pageOptions, inputMessage, createChat };
