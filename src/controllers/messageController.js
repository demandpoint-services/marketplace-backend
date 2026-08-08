const {
  getOrCreateBookingConversation,
  getConversationForUser,
  listUserConversations,
  sendConversationMessage,
  getConversationMessages,
  markConversationRead,
  getTotalUnreadMessages,
} = require("../services/messageService");

// POST /api/messages/bookings/:bookingId/conversation
exports.openBookingConversation = async (req, res) => {
  try {
    const conversation = await getOrCreateBookingConversation({
      bookingId: req.params.bookingId,
      requestingUserId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("Open booking conversation error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      message: error?.message || "Unable to open this conversation.",
    });
  }
};

// GET /api/messages/conversations
exports.getMyConversations = async (req, res) => {
  try {
    const conversations = await listUserConversations(req.user._id);

    const totalUnread = await getTotalUnreadMessages(req.user._id);

    return res.status(200).json({
      success: true,
      conversations,
      totalUnread,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your conversations.",
    });
  }
};

// GET /api/messages/conversations/:conversationId
exports.getConversation = async (req, res) => {
  try {
    const conversation = await getConversationForUser({
      conversationId: req.params.conversationId,
      userId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("Get conversation error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      message: error?.message || "Unable to retrieve this conversation.",
    });
  }
};

// GET /api/messages/conversations/:conversationId/messages
exports.getMessages = async (req, res) => {
  try {
    const result = await getConversationMessages({
      conversationId: req.params.conversationId,
      userId: req.user._id,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Get conversation messages error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      message: error?.message || "Unable to retrieve messages.",
    });
  }
};

// POST /api/messages/conversations/:conversationId/messages
exports.sendMessage = async (req, res) => {
  try {
    const message = await sendConversationMessage({
      conversationId: req.params.conversationId,
      sender: req.user,
      text: req.body?.text,
      attachments: req.body?.attachments,
    });

    return res.status(201).json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("Send conversation message error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      message: error?.message || "Unable to send your message.",
    });
  }
};

// PATCH /api/messages/conversations/:conversationId/read
exports.markConversationAsRead = async (req, res) => {
  try {
    const conversation = await markConversationRead({
      conversationId: req.params.conversationId,
      userId: req.user._id,
    });

    const totalUnread = await getTotalUnreadMessages(req.user._id);

    return res.status(200).json({
      success: true,
      conversation,
      totalUnread,
    });
  } catch (error) {
    console.error("Mark conversation read error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      message: error?.message || "Unable to mark this conversation as read.",
    });
  }
};

// GET /api/messages/unread-count
exports.getUnreadMessageCount = async (req, res) => {
  try {
    const count = await getTotalUnreadMessages(req.user._id);

    return res.status(200).json({
      success: true,
      unreadCount: count,
    });
  } catch (error) {
    console.error("Get unread message count error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve unread message count.",
    });
  }
};
