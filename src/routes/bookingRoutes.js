const express = require("express");
const router = express.Router();

const {
  createBooking,
  getMyBookings,
  getArtisanBookings,
  updateBookingStatus,
} = require("../controllers/bookingController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

// CLIENT
router.post("/", protect, createBooking);
router.get("/my", protect, getMyBookings);

// ARTISAN
router.get("/artisan", protect, artisanOnly, getArtisanBookings);
router.put("/:id", protect, artisanOnly, updateBookingStatus);

module.exports = router;
