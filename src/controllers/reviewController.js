const {
  createBookingReview,
  getArtisanReviews,
  getBookingReview,
  reportReview,
} = require("../services/reviewService");

function getErrorStatus(error) {
  if (
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    return error.status;
  }

  return 500;
}

// POST /api/reviews
exports.createReview = async (req, res) => {
  try {
    if (req.user.role !== "client") {
      return res.status(403).json({
        success: false,
        message: "Only clients can review completed bookings.",
      });
    }

    const { bookingId, rating, comment } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required.",
      });
    }

    const result = await createBookingReview({
      bookingId,
      client: req.user,
      rating,
      comment,
    });

    return res.status(201).json({
      success: true,
      message: "Your review has been published.",
      ...result,
    });
  } catch (error) {
    console.error("Create review error:", error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      code: error?.code || null,
      message: error?.message || "Unable to submit your review.",
    });
  }
};

// GET /api/reviews/artisan/:artisanId
exports.getReviewsForArtisan = async (req, res) => {
  try {
    const result = await getArtisanReviews({
      artisanId: req.params.artisanId,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Get artisan reviews error:", error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: error?.message || "Unable to retrieve reviews.",
    });
  }
};

// GET /api/reviews/booking/:bookingId
exports.getReviewForBooking = async (req, res) => {
  try {
    const result = await getBookingReview({
      bookingId: req.params.bookingId,
      userId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Get booking review error:", error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      message: error?.message || "Unable to retrieve this review.",
    });
  }
};

// POST /api/reviews/:reviewId/report
exports.reportReview = async (req, res) => {
  try {
    const review = await reportReview({
      reviewId: req.params.reviewId,
      user: req.user,
      reason: req.body?.reason,
      details: req.body?.details,
    });

    return res.status(200).json({
      success: true,
      message: "Thank you. This review has been submitted for moderation.",
      reviewId: review._id,
    });
  } catch (error) {
    console.error("Report review error:", error);

    return res.status(getErrorStatus(error)).json({
      success: false,
      code: error?.code || null,
      message: error?.message || "Unable to report this review.",
    });
  }
};
