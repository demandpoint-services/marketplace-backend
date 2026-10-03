const express = require("express");

const router = express.Router();

const {
  createSpaceBooking,
  getMySpaceBookings,
  getOwnerSpaceBookings,
  getSpaceBookingById,
  cancelSpaceBooking,
  declineSpaceBooking,
  completeSpaceBooking,
  initializeSpaceBookingPayment,
  verifySpaceBookingPayment,
  handleSpaceBookingPaymentWebhook,
} = require("../controllers/spaceBookingController");

const { verifyPaystackWebhook } = require("../middleware/paystackWebhookMiddleware");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

// ============================================================
// CREATE BOOKING
// ============================================================

router.post("/", protect, createSpaceBooking);

// ============================================================
// CLIENT BOOKINGS
// ============================================================

router.get("/me", protect, getMySpaceBookings);

// ============================================================
// OWNER BOOKINGS
// ============================================================

router.get("/owner/me", protect, artisanOnly, getOwnerSpaceBookings);

// ============================================================
// PAYMENT
// IMPORTANT: keep this before /:id
// ============================================================

router.get("/payment/verify/:reference", protect, verifySpaceBookingPayment);

router.post("/payment/webhook", verifyPaystackWebhook, handleSpaceBookingPaymentWebhook);

router.post("/:id/payment/initialize", protect, initializeSpaceBookingPayment);

// ============================================================
// BOOKING ACTIONS
// ============================================================

router.patch("/:id/decline", protect, artisanOnly, declineSpaceBooking);

router.patch("/:id/complete", protect, artisanOnly, completeSpaceBooking);

router.patch("/:id/cancel", protect, cancelSpaceBooking);

// ============================================================
// GET SINGLE BOOKING
// Keep this LAST because /:id is generic.
// ============================================================

router.get("/:id", protect, getSpaceBookingById);

module.exports = router;
