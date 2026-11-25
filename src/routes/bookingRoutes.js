const express = require("express");

const router = express.Router();

const {
  createBooking,
  getMyBookings,
  getBookingDetail,
  listServiceBookings,
  getArtisanBookings,
  updateBookingStatus,
  sendBookingMessage,
} = require("../controllers/bookingController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

// CLIENT
router.post("/", protect, createBooking);
router.get("/", protect, listServiceBookings);
router.get("/my", protect, getMyBookings);
router.post("/:id/message", protect, sendBookingMessage);

// ARTISAN
router.get("/artisan", protect, artisanOnly, getArtisanBookings);
router.get("/:id", protect, getBookingDetail);

// CLIENT + ARTISAN STATUS LIFECYCLE
// The controller validates ownership, actor role, allowed transitions,
// and artisan subscription access.
router.patch("/:id/status", protect, updateBookingStatus);

// Legacy compatibility for any existing callers using PUT /:id.
router.put("/:id", protect, updateBookingStatus);

module.exports = router;
