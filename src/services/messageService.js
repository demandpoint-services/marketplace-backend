const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const { isDeepStrictEqual } = require("node:util");
const { requireMutationIndex } = require("./marketplaceContractIndexes");
const { cursorFor, parseBoundary } = require("./messagePaging");
const { createNotification } = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

function idsMatch(first, second) {
  const firstId = first?._id ?? first;
  const secondId = second?._id ?? second;
  if (!mongoose.isObjectIdOrHexString(firstId) || !mongoose.isObjectIdOrHexString(secondId)) return false;
  return String(firstId).toLowerCase() === String(secondId).toLowerCase();
}

function getConversationSide(conversation, userId) {
  if (idsMatch(conversation.client, userId)) {
    return "client";
  }

  if (idsMatch(conversation.artisan, userId)) {
    return "artisan";
  }

  return null;
}

function assertConversationParticipant(conversation, userId) {
  const side = getConversationSide(conversation, userId);

  if (!side) {
    const error = new Error(
      "You are not permitted to access this conversation.",
    );

    error.status = 403;

    throw error;
  }

  return side;
}

async function getBookingParticipants(bookingId) {
  if (!mongoose.isValidObjectId(bookingId)) {
    const error = new Error("Invalid booking ID.");
    error.status = 400;
    throw error;
  }

  const booking = await Booking.findById(bookingId)
    .populate("client", "name email profileImage role isSuspended")
    .populate({
      path: "artisan",
      populate: {
        path: "user",
        select: "name email profileImage role isSuspended",
      },
    });

  if (!booking) {
    const error = new Error("Booking not found.");
    error.status = 404;
    throw error;
  }

  const client = booking.client;
  const artisan = booking.artisan?.user;

  if (!client) {
    const error = new Error("Booking client could not be found.");
    error.status = 404;
    throw error;
  }

  if (!artisan) {
    const error = new Error("Booking professional could not be found.");
    error.status = 404;
    throw error;
  }

  return {
    booking,
    client,
    artisan,
  };
}

async function getOrCreateBookingConversation({ bookingId, requestingUserId }) {
  const { booking, client, artisan } = await getBookingParticipants(bookingId);

  const isClient = idsMatch(client._id, requestingUserId);
  const isArtisan = idsMatch(artisan._id, requestingUserId);

  if (!isClient && !isArtisan) {
    const error = new Error(
      "You are not permitted to access messaging for this booking.",
    );

    error.status = 403;

    throw error;
  }

  let conversation = await Conversation.findOne({
    booking: booking._id,
  });

  if (!conversation) {
    try {
      conversation = await Conversation.create({
        booking: booking._id,
        client: client._id,
        artisan: artisan._id,
        participants: [client._id, artisan._id],
      });
    } catch (error) {
      /*
       * Two users may open the chat at almost the exact same time.
       * The unique booking index ensures only one conversation wins.
       */
      if (error?.code === 11000) {
        conversation = await Conversation.findOne({
          booking: booking._id,
        });
      } else {
        throw error;
      }
    }
  }

  if (!conversation) throw new Error("Unable to retrieve the booking conversation.");
  assertConversationParticipant(conversation, requestingUserId);

  if (!idsMatch(booking.conversation, conversation._id)) {
    await Booking.updateOne({ _id: booking._id }, { $set: { conversation: conversation._id } });
  }

  return populateConversation(conversation._id);
}

async function populateConversation(conversationId) {
  return Conversation.findById(conversationId)
    .populate("client", "name email profileImage role lastSeen")
    .populate("artisan", "name email profileImage role lastSeen")
    .populate({
      path: "booking",
      select: "service date time address status artisan client createdAt",
      populate: {
        path: "artisan",
        select: "category rating totalReviews responseTime",
      },
    })
    .populate({
      path: "lastMessage",
      populate: [
        {
          path: "sender",
          select: "name profileImage role",
        },
        {
          path: "recipient",
          select: "name profileImage role",
        },
      ],
    });
}

async function getConversationForUser({ conversationId, userId }) {
  if (!mongoose.isValidObjectId(conversationId)) {
    const error = new Error("Invalid conversation ID.");
    error.status = 400;
    throw error;
  }

  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    const error = new Error("Conversation not found.");
    error.status = 404;
    throw error;
  }

  assertConversationParticipant(conversation, userId);

  return populateConversation(conversation._id);
}

async function listUserConversations(userId) {
  const conversations = await Conversation.find({
    participants: userId,
  })
    .populate("client", "name profileImage role lastSeen")
    .populate("artisan", "name profileImage role lastSeen")
    .populate("booking", "service date time status createdAt")
    .populate({
      path: "lastMessage",
      populate: {
        path: "sender",
        select: "name profileImage role",
      },
    })
    .sort({
      lastMessageAt: -1,
      updatedAt: -1,
    });

  return conversations;
}

function getRecipientForConversation(conversation, senderId) {
  if (idsMatch(conversation.client, senderId)) {
    return conversation.artisan;
  }

  if (idsMatch(conversation.artisan, senderId)) {
    return conversation.client;
  }

  const error = new Error(
    "You are not permitted to send messages in this conversation.",
  );

  error.status = 403;

  throw error;
}

function determineMessageType({ text, attachments }) {
  const hasText = Boolean(text?.trim());

  const validAttachments = Array.isArray(attachments) ? attachments : [];

  if (!validAttachments.length) {
    return "text";
  }

  if (hasText) {
    return "mixed";
  }

  if (validAttachments.every((attachment) => attachment.type === "image")) {
    return "image";
  }

  return "file";
}

function sanitizeAttachments(attachments = []) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter((attachment) => attachment && attachment.url && attachment.type)
    .slice(0, 5)
    .map((attachment) => ({
      type: attachment.type,
      url: String(attachment.url).trim(),
      publicId: String(attachment.publicId || "").trim(),
      thumbnailUrl: String(attachment.thumbnailUrl || "").trim(),
      originalName: String(attachment.originalName || "").trim(),
      mimeType: String(attachment.mimeType || "").trim(),
      size: Math.max(Number(attachment.size) || 0, 0),
    }));
}

function messageError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

async function sendConversationMessage({ conversationId, sender, text = "", attachments = [], clientMutationId }) {
  if (clientMutationId !== undefined && (typeof clientMutationId !== "string" || !/^[\w-]{1,80}$/.test(clientMutationId))) {
    throw messageError(400, "INVALID_MUTATION_ID", "Invalid client mutation identifier.");
  }
  const normalizedText = typeof text === "string" ? text.trim() : "";
  const normalizedAttachments = sanitizeAttachments(attachments);
  if ((!normalizedText && !normalizedAttachments.length) || normalizedText.length > 2000) {
    throw messageError(400, "INVALID_MESSAGE", "Enter a message of up to 2,000 characters or attach a file.");
  }
  const key = { conversation: conversationId, sender: sender._id, clientMutationId };
  if (clientMutationId) await requireMutationIndex(Message.collection, "messages");
  function replay(message) {
    const existing = sanitizeAttachments(message.attachments.map(item => item.toObject()));
    if (message.text !== normalizedText || !isDeepStrictEqual(existing, normalizedAttachments)) {
      throw messageError(409, "MUTATION_CONFLICT", "This identifier was used for a different message.");
    }
    return { id: message._id, replayed: true };
  }
  let result;
  try {
    result = await mongoose.connection.transaction(async session => {
      const conversation = await Conversation.findById(conversationId).session(session);
      if (!conversation) throw messageError(404, "NOT_FOUND", "Conversation not found.");
      const senderSide = assertConversationParticipant(conversation, sender._id);
      if (clientMutationId) {
        const existing = await Message.findOne(key).session(session);
        if (existing) return replay(existing);
      }
      if (conversation.status === "closed") throw messageError(409, "CONVERSATION_CLOSED", "This conversation is closed.");
      const recipientId = getRecipientForConversation(conversation, sender._id);
      const [message] = await Message.create([{
        ...key, booking: conversation.booking, recipient: recipientId,
        type: determineMessageType({ text: normalizedText, attachments: normalizedAttachments }),
        text: normalizedText, attachments: normalizedAttachments,
        createdAt: new Date(Math.max(Date.now(), (conversation.lastMessageAt?.getTime() ?? -1) + 1)),
      }], { session });
      await Conversation.findByIdAndUpdate(conversation._id, {
        $set: { lastMessage: message._id, lastMessageAt: message.createdAt },
        $inc: { [senderSide === "client" ? "artisanUnreadCount" : "clientUnreadCount"]: 1 },
      }, { session });
      const notificationPreview = normalizedText || (normalizedAttachments.length === 1
        ? "Sent you an attachment." : "Sent you " + normalizedAttachments.length + " attachments.");
      await createNotification({
        recipient: recipientId, actor: sender._id,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED, category: NOTIFICATION_CATEGORIES.MESSAGE,
        title: "New message from " + (sender.name || "DemandPoint user"),
        message: notificationPreview.length > 180 ? notificationPreview.slice(0, 177) + "..." : notificationPreview,
        actionUrl: "/messages?conversation=" + conversation._id,
        resourceType: "message", resourceId: message._id, dedupeKey: "message:" + message._id,
        metadata: { conversationId: String(conversation._id), bookingId: String(conversation.booking),
          messageId: String(message._id), senderId: String(sender._id) },
      }, { session });
      return { id: message._id, replayed: false };
    });
  } catch (error) {
    if (error.code !== 11000 || !clientMutationId) throw error;
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw error;
    assertConversationParticipant(conversation, sender._id);
    const existing = await Message.findOne(key);
    if (!existing) throw error;
    result = replay(existing);
  }
  const message = await Message.findById(result.id)
    .populate("sender", "name profileImage role lastSeen")
    .populate("recipient", "name profileImage role lastSeen");
  return { message, replayed: result.replayed };
}

async function getConversationMessages({ conversationId, userId, page, before, limit = 30 }) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw messageError(404, "NOT_FOUND", "Conversation not found.");
  assertConversationParticipant(conversation, userId);
  const safePage = Math.max(Math.floor(Number(page) || 1), 1);
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit) || 30), 1), 100);
  const boundary = parseBoundary(before, page);
  const filter = { conversation: conversation._id };
  if (boundary) filter.$or = [{ createdAt: { $lt: boundary.createdAt } },
    { createdAt: boundary.createdAt, _id: { $lt: boundary._id } }];
  const [messages, total] = await Promise.all([
    Message.find(filter)
      .populate("sender", "name profileImage role lastSeen")
      .populate("recipient", "name profileImage role lastSeen")
      .sort({ createdAt: -1, _id: -1 })
      .skip(boundary ? 0 : (safePage - 1) * safeLimit)
      .limit(safeLimit + 1),
    Message.countDocuments({ conversation: conversation._id }),
  ]);
  const hasMore = messages.length > safeLimit;
  const rows = messages.slice(0, safeLimit);
  const nextCursor = hasMore ? cursorFor(rows.at(-1)) : null;
  return {
    messages: rows.reverse(),
    pagination: { page: boundary ? null : safePage, limit: safeLimit, total,
      pages: Math.max(Math.ceil(total / safeLimit), 1), hasMore, nextCursor },
  };
}

async function markConversationRead({ conversationId, userId, throughMessageId }) {
  await mongoose.connection.transaction(async session => {
    const conversation = await Conversation.findById(conversationId).session(session);
    if (!conversation) throw messageError(404, "NOT_FOUND", "Conversation not found.");
    const side = assertConversationParticipant(conversation, userId);
    const filter = { conversation: conversation._id, recipient: userId, read: false };
    if (throughMessageId !== undefined) {
      if (!mongoose.isObjectIdOrHexString(throughMessageId)) throw messageError(400, "INVALID_READ_BOUNDARY", "Invalid message boundary.");
      const boundary = await Message.findOne({ conversation: conversation._id, _id: throughMessageId }).session(session);
      if (!boundary) throw messageError(400, "INVALID_READ_BOUNDARY", "Message boundary is not in this conversation.");
      filter.$or = [{ createdAt: { $lt: boundary.createdAt } }, { createdAt: boundary.createdAt, _id: { $lte: boundary._id } }];
    }
    await Message.updateMany(filter, { $set: { read: true, readAt: new Date() } }, { session });
    const remaining = await Message.countDocuments({ conversation: conversation._id, recipient: userId, read: false }).session(session);
    await Conversation.findByIdAndUpdate(conversation._id, { $set: { [side + "UnreadCount"]: remaining } }, { session });
  });
  return populateConversation(conversationId);
}

async function getTotalUnreadMessages(userId) {
  const threads = await Conversation.distinct("_id", { $or: [{ client: userId }, { artisan: userId }] });
  return Message.countDocuments({ conversation: { $in: threads }, recipient: userId, read: false });
}

module.exports = {
  getOrCreateBookingConversation,
  getConversationForUser,
  listUserConversations,
  sendConversationMessage,
  getConversationMessages,
  markConversationRead,
  getTotalUnreadMessages,
  assertConversationParticipant,
};
