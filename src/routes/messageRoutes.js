const express = require("express");

const router = express.Router();

const {
  openBookingConversation,
  getMyConversations,
  getConversation,
  getMessages,
  sendMessage,
  markConversationAsRead,
  getUnreadMessageCount,
} = require("../controllers/messageController");

const { protect } = require("../middleware/authMiddleware");

// Conversation inbox
router.get("/conversations", protect, getMyConversations);

// Global unread badge
router.get("/unread-count", protect, getUnreadMessageCount);

// Open or create the conversation tied to a booking
router.post(
  "/bookings/:bookingId/conversation",
  protect,
  openBookingConversation,
);

// Single conversation
router.get("/conversations/:conversationId", protect, getConversation);

// Message history
router.get("/conversations/:conversationId/messages", protect, getMessages);

// Send message
router.post("/conversations/:conversationId/messages", protect, sendMessage);

// Mark conversation read
router.patch(
  "/conversations/:conversationId/read",
  protect,
  markConversationAsRead,
);

module.exports = router;
