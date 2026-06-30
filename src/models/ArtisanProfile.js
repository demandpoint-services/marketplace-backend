const mongoose = require("mongoose");

const artisanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // One artisan profile per user
    },

    // Primary service category
    category: {
      type: String,
      required: true,
      trim: true,
    },

    // Additional skills/services
    skills: [
      {
        type: String,
        trim: true,
      },
    ],

    // Pricing
    minimumCharge: {
      type: Number,
      default: 0,
    },

    hourlyRate: {
      type: Number,
      default: 0,
    },

    // Experience
    yearsOfExperience: {
      type: Number,
      default: 0,
    },

    // Areas served
    serviceAreas: [
      {
        type: String,
        trim: true,
      },
    ],

    // Portfolio images
    portfolio: [
      {
        type: String,
      },
    ],

    // Marketplace metrics
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    totalReviews: {
      type: Number,
      default: 0,
    },

    completedJobs: {
      type: Number,
      default: 0,
    },

    // Verification
    verified: {
      type: Boolean,
      default: false,
    },

    // Availability
    available: {
      type: Boolean,
      default: true,
    },

    // Optional response time
    responseTime: {
      type: String,
      default: "Usually responds within a few hours",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("ArtisanProfile", artisanSchema);
