const express = require("express");

const router = express.Router();

const {
  createBooking,
  getMyBookings,
  getArtisanBookings,
  updateBookingStatus,
  sendBookingMessage,
} = require("../controllers/bookingController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");
const requireActiveSubscription = require("../middleware/requireActiveSubscription");

// CLIENT
router.post("/", protect, createBooking);
router.get("/my", protect, getMyBookings);
router.post("/:id/message", protect, sendBookingMessage);

// ARTISAN
router.get("/artisan", protect, artisanOnly, getArtisanBookings);

router.put(
  "/:id",
  protect,
  artisanOnly,
  requireActiveSubscription,
  updateBookingStatus,
);

module.exports = router;
