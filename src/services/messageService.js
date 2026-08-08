const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const { createNotificationSafely } = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

function idsMatch(first, second) {
  if (!first || !second) return false;

  return String(first) === String(second);
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

  if (
    conversation &&
    (!booking.conversation || !idsMatch(booking.conversation, conversation._id))
  ) {
    booking.conversation = conversation._id;

    await booking.save();
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

  const conversation = await populateConversation(conversationId);

  if (!conversation) {
    const error = new Error("Conversation not found.");
    error.status = 404;
    throw error;
  }

  assertConversationParticipant(conversation, userId);

  return conversation;
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

async function sendConversationMessage({
  conversationId,
  sender,
  text = "",
  attachments = [],
}) {
  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    const error = new Error("Conversation not found.");

    error.status = 404;

    throw error;
  }

  const senderSide = assertConversationParticipant(conversation, sender._id);

  if (conversation.status === "closed") {
    const error = new Error("This conversation is closed.");

    error.status = 409;

    throw error;
  }

  const normalizedText = typeof text === "string" ? text.trim() : "";

  const normalizedAttachments = sanitizeAttachments(attachments);

  if (!normalizedText && normalizedAttachments.length === 0) {
    const error = new Error("Enter a message or attach a file.");

    error.status = 400;

    throw error;
  }

  if (normalizedText.length > 2000) {
    const error = new Error("Message must not exceed 2,000 characters.");

    error.status = 400;

    throw error;
  }

  const recipientId = getRecipientForConversation(conversation, sender._id);

  const message = await Message.create({
    conversation: conversation._id,
    booking: conversation.booking,
    sender: sender._id,
    recipient: recipientId,
    type: determineMessageType({
      text: normalizedText,
      attachments: normalizedAttachments,
    }),
    text: normalizedText,
    attachments: normalizedAttachments,
  });

  const unreadField =
    senderSide === "client" ? "artisanUnreadCount" : "clientUnreadCount";

  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: {
      lastMessage: message._id,
      lastMessageAt: message.createdAt,
    },
    $inc: {
      [unreadField]: 1,
    },
  });

  const populatedMessage = await Message.findById(message._id)
    .populate("sender", "name profileImage role lastSeen")
    .populate("recipient", "name profileImage role lastSeen");

  const notificationPreview =
    normalizedText ||
    (normalizedAttachments.length === 1
      ? "Sent you an attachment."
      : `Sent you ${normalizedAttachments.length} attachments.`);

  await createNotificationSafely(
    {
      recipient: recipientId,
      actor: sender._id,
      type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
      category: NOTIFICATION_CATEGORIES.MESSAGE,
      title: `New message from ${sender.name || "DemandPoint user"}`,
      message:
        notificationPreview.length > 180
          ? `${notificationPreview.slice(0, 177)}...`
          : notificationPreview,
      actionUrl: `/messages?conversation=${conversation._id}`,
      resourceType: "message",
      resourceId: message._id,
      dedupeKey: `message:${message._id}`,
      metadata: {
        conversationId: conversation._id.toString(),
        bookingId: conversation.booking.toString(),
        messageId: message._id.toString(),
        senderId: sender._id.toString(),
      },
    },
    "Message notification",
  );

  return populatedMessage;
}

async function getConversationMessages({
  conversationId,
  userId,
  page = 1,
  limit = 30,
}) {
  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    const error = new Error("Conversation not found.");

    error.status = 404;

    throw error;
  }

  assertConversationParticipant(conversation, userId);

  const safePage = Math.max(Number(page) || 1, 1);

  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const skip = (safePage - 1) * safeLimit;

  const [messages, total] = await Promise.all([
    Message.find({
      conversation: conversation._id,
    })
      .populate("sender", "name profileImage role lastSeen")
      .populate("recipient", "name profileImage role lastSeen")
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(safeLimit),

    Message.countDocuments({
      conversation: conversation._id,
    }),
  ]);

  return {
    /*
     * Database query returns newest first for efficient paging.
     * Reverse this page so the frontend receives chronological order.
     */
    messages: messages.reverse(),

    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
      hasMore: safePage * safeLimit < total,
    },
  };
}

async function markConversationRead({ conversationId, userId }) {
  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    const error = new Error("Conversation not found.");

    error.status = 404;

    throw error;
  }

  const side = assertConversationParticipant(conversation, userId);

  const readAt = new Date();

  await Message.updateMany(
    {
      conversation: conversation._id,
      recipient: userId,
      read: false,
    },
    {
      $set: {
        read: true,
        readAt,
      },
    },
  );

  const unreadField =
    side === "client" ? "clientUnreadCount" : "artisanUnreadCount";

  conversation[unreadField] = 0;

  await conversation.save();

  return populateConversation(conversation._id);
}

async function getTotalUnreadMessages(userId) {
  const conversations = await Conversation.find({
    participants: userId,
  }).select("client artisan clientUnreadCount artisanUnreadCount");

  return conversations.reduce((total, conversation) => {
    if (idsMatch(conversation.client, userId)) {
      return total + Number(conversation.clientUnreadCount || 0);
    }

    if (idsMatch(conversation.artisan, userId)) {
      return total + Number(conversation.artisanUnreadCount || 0);
    }

    return total;
  }, 0);
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
