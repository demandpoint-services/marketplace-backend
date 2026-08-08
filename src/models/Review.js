const mongoose = require("mongoose");

const reviewReportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    reason: {
      type: String,
      enum: [
        "spam",
        "harassment",
        "inappropriate",
        "misleading",
        "privacy",
        "other",
      ],
      required: true,
    },

    details: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    reportedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  },
);

const reviewSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },

    artisan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ArtisanProfile",
      required: true,
      index: true,
    },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
      maxlength: 1500,
      default: "",
    },

    status: {
      type: String,
      enum: ["published", "hidden", "under_review", "removed"],
      default: "published",
      index: true,
    },

    reports: {
      type: [reviewReportSchema],
      default: [],
    },

    reportedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    moderatedAt: {
      type: Date,
      default: null,
    },

    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    moderationReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

reviewSchema.index({
  artisan: 1,
  status: 1,
  createdAt: -1,
});

reviewSchema.index({
  client: 1,
  createdAt: -1,
});

module.exports = mongoose.model("Review", reviewSchema);
