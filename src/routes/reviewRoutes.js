const express = require("express");

const router = express.Router();

const {
  createReview,
  getReviewsForArtisan,
  getReviewForBooking,
  reportReview,
} = require("../controllers/reviewController");

const { protect } = require("../middleware/authMiddleware");

// Public artisan review list
router.get("/artisan/:artisanId", getReviewsForArtisan);

// Review status for a specific booking
router.get("/booking/:bookingId", protect, getReviewForBooking);

// Client creates a review
router.post("/", protect, createReview);

// Authenticated user reports a review
router.post("/:reviewId/report", protect, reportReview);

module.exports = router;
