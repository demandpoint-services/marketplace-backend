const mongoose = require("mongoose");

const Review = require("../models/Review");
const Booking = require("../models/Booking");
const ArtisanProfile = require("../models/ArtisanProfile");

const { createNotificationSafely } = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

function createServiceError(message, status = 400, code = null) {
  const error = new Error(message);

  error.status = status;

  if (code) {
    error.code = code;
  }

  return error;
}

function normalizeRating(value) {
  const rating = Number(value);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw createServiceError(
      "Rating must be a whole number between 1 and 5.",
      400,
      "INVALID_REVIEW_RATING",
    );
  }

  return rating;
}

function normalizeComment(value) {
  if (typeof value !== "string") {
    return "";
  }

  const comment = value.trim();

  if (comment.length > 1500) {
    throw createServiceError(
      "Review comment must not exceed 1,500 characters.",
      400,
      "REVIEW_COMMENT_TOO_LONG",
    );
  }

  return comment;
}

async function recalculateArtisanRating(artisanId) {
  const result = await Review.aggregate([
    {
      $match: {
        artisan: new mongoose.Types.ObjectId(String(artisanId)),
        status: "published",
      },
    },
    {
      $group: {
        _id: "$artisan",
        averageRating: {
          $avg: "$rating",
        },
        totalReviews: {
          $sum: 1,
        },
      },
    },
  ]);

  const stats = result[0] || {
    averageRating: 0,
    totalReviews: 0,
  };

  const rating =
    stats.totalReviews > 0
      ? Math.round(Number(stats.averageRating) * 10) / 10
      : 0;

  await ArtisanProfile.findByIdAndUpdate(artisanId, {
    $set: {
      rating,
      totalReviews: Number(stats.totalReviews) || 0,
    },
  });

  return {
    rating,
    totalReviews: Number(stats.totalReviews) || 0,
  };
}

async function getReviewableBooking({ bookingId, clientId }) {
  if (!mongoose.isValidObjectId(bookingId)) {
    throw createServiceError("Invalid booking ID.", 400, "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findById(bookingId)
    .populate("client", "name email profileImage")
    .populate({
      path: "artisan",
      populate: {
        path: "user",
        select: "name email profileImage",
      },
    });

  if (!booking) {
    throw createServiceError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  }

  const bookingClientId = booking.client?._id || booking.client;

  if (String(bookingClientId) !== String(clientId)) {
    throw createServiceError(
      "You can only review your own bookings.",
      403,
      "REVIEW_NOT_ALLOWED",
    );
  }

  if (booking.status !== "completed") {
    throw createServiceError(
      "Only completed bookings can be reviewed.",
      409,
      "BOOKING_NOT_COMPLETED",
    );
  }

  if (!booking.artisan) {
    throw createServiceError(
      "The professional for this booking could not be found.",
      404,
      "ARTISAN_NOT_FOUND",
    );
  }

  return booking;
}

async function createBookingReview({ bookingId, client, rating, comment }) {
  const booking = await getReviewableBooking({
    bookingId,
    clientId: client._id,
  });

  const existingReview = await Review.findOne({
    booking: booking._id,
  }).select("_id");

  if (existingReview) {
    throw createServiceError(
      "You have already reviewed this booking.",
      409,
      "BOOKING_ALREADY_REVIEWED",
    );
  }

  const normalizedRating = normalizeRating(rating);
  const normalizedComment = normalizeComment(comment);

  let review;

  try {
    review = await Review.create({
      booking: booking._id,
      artisan: booking.artisan._id,
      client: client._id,
      rating: normalizedRating,
      comment: normalizedComment,
    });
  } catch (error) {
    /*
     * The booking field is unique. This also protects against two
     * review submissions arriving at nearly the same time.
     */
    if (error?.code === 11000) {
      throw createServiceError(
        "You have already reviewed this booking.",
        409,
        "BOOKING_ALREADY_REVIEWED",
      );
    }

    throw error;
  }

  booking.review = review._id;
  booking.reviewedAt = new Date();

  await booking.save();

  const ratingStats = await recalculateArtisanRating(booking.artisan._id);

  const artisanUser = booking.artisan?.user?._id || booking.artisan?.user;

  if (artisanUser) {
    await createNotificationSafely(
      {
        recipient: artisanUser,
        actor: client._id,
        type: NOTIFICATION_TYPES.NEW_REVIEW,
        category: NOTIFICATION_CATEGORIES.REVIEW,
        title: "You received a new review",
        message: `${
          client.name || "A client"
        } rated your completed job ${normalizedRating} out of 5 stars.`,
        actionUrl: `/services/${booking.artisan._id}`,
        resourceType: "review",
        resourceId: review._id,
        dedupeKey: `review:${review._id}`,
        metadata: {
          reviewId: review._id.toString(),
          bookingId: booking._id.toString(),
          artisanId: booking.artisan._id.toString(),
          rating: normalizedRating,
        },
      },
      "Review notification",
    );
  }

  return {
    review: await populateReview(review._id),
    artisanRating: ratingStats,
  };
}

async function populateReview(reviewId) {
  return Review.findById(reviewId)
    .populate("client", "name profileImage createdAt")
    .populate({
      path: "artisan",
      select: "category rating totalReviews user",
      populate: {
        path: "user",
        select: "name profileImage",
      },
    })
    .populate("booking", "service date completedAt");
}

async function getArtisanReviews({ artisanId, page = 1, limit = 10 }) {
  if (!mongoose.isValidObjectId(artisanId)) {
    throw createServiceError("Invalid artisan ID.", 400, "INVALID_ARTISAN_ID");
  }

  const artisan = await ArtisanProfile.findById(artisanId).select(
    "_id rating totalReviews",
  );

  if (!artisan) {
    throw createServiceError("Artisan not found.", 404, "ARTISAN_NOT_FOUND");
  }

  const safePage = Math.max(Number(page) || 1, 1);

  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const skip = (safePage - 1) * safeLimit;

  const filter = {
    artisan: artisan._id,
    status: "published",
  };

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate("client", "name profileImage createdAt")
      .populate("booking", "service date completedAt")
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(safeLimit),

    Review.countDocuments(filter),
  ]);

  return {
    reviews,
    rating: artisan.rating,
    totalReviews: artisan.totalReviews,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
      hasMore: safePage * safeLimit < total,
    },
  };
}

async function getBookingReview({ bookingId, userId }) {
  if (!mongoose.isValidObjectId(bookingId)) {
    throw createServiceError("Invalid booking ID.", 400);
  }

  const booking = await Booking.findById(bookingId)
    .select("client artisan status review reviewedAt")
    .populate({
      path: "artisan",
      select: "user",
    });

  if (!booking) {
    throw createServiceError("Booking not found.", 404);
  }

  const artisanUserId = booking.artisan?.user?._id || booking.artisan?.user;

  const participant =
    String(booking.client) === String(userId) ||
    String(artisanUserId) === String(userId);

  if (!participant) {
    throw createServiceError(
      "You are not permitted to view this booking review.",
      403,
    );
  }

  const review = await Review.findOne({
    booking: booking._id,
  })
    .populate("client", "name profileImage")
    .populate("booking", "service date completedAt");

  return {
    review,
    canReview:
      String(booking.client) === String(userId) &&
      booking.status === "completed" &&
      !review,
  };
}

async function reportReview({ reviewId, user, reason, details }) {
  if (!mongoose.isValidObjectId(reviewId)) {
    throw createServiceError("Invalid review ID.", 400);
  }

  const review = await Review.findById(reviewId);

  if (!review || review.status === "removed") {
    throw createServiceError("Review not found.", 404);
  }

  if (String(review.client) === String(user._id)) {
    throw createServiceError("You cannot report your own review.", 400);
  }

  const allowedReasons = [
    "spam",
    "harassment",
    "inappropriate",
    "misleading",
    "privacy",
    "other",
  ];

  const normalizedReason = String(reason || "")
    .trim()
    .toLowerCase();

  if (!allowedReasons.includes(normalizedReason)) {
    throw createServiceError("Please select a valid report reason.", 400);
  }

  const alreadyReported = review.reports.some(
    (report) => String(report.reportedBy) === String(user._id),
  );

  if (alreadyReported) {
    throw createServiceError(
      "You have already reported this review.",
      409,
      "REVIEW_ALREADY_REPORTED",
    );
  }

  const normalizedDetails = typeof details === "string" ? details.trim() : "";

  if (normalizedDetails.length > 1000) {
    throw createServiceError(
      "Report details must not exceed 1,000 characters.",
      400,
    );
  }

  review.reports.push({
    reportedBy: user._id,
    reason: normalizedReason,
    details: normalizedDetails,
  });

  review.reportedCount = review.reports.length;

  /*
   * We do not automatically hide a review after one report.
   * Instead we flag it for future admin moderation.
   */
  review.status = "under_review";

  await review.save();

  return review;
}

module.exports = {
  createBookingReview,
  getArtisanReviews,
  getBookingReview,
  reportReview,
  recalculateArtisanRating,
};
