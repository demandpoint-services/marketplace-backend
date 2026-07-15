const express = require("express");

const {
  getMyNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  clearReadNotifications,
} = require("../controllers/notificationController");

const {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
} = require("../controllers/notificationPreferenceController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/", getMyNotifications);
router.get("/unread-count", getUnreadCount);

router.patch("/read-all", markAllNotificationsAsRead);
router.patch("/:id/read", markNotificationAsRead);

router.delete("/read", clearReadNotifications);
router.delete("/:id", deleteNotification);

router.get("/preferences/me", getMyNotificationPreferences);
router.put("/preferences/me", updateMyNotificationPreferences);

module.exports = router;
