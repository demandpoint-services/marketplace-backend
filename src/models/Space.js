const mongoose = require("mongoose");

const spaceMediaSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      trim: true,
      default: "",
    },

    alt: {
      type: String,
      trim: true,
      maxlength: 180,
      default: "",
    },

    type: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
  },
  {
    _id: false,
  }
);

const availabilityWindowSchema = new mongoose.Schema(
  {
    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },

    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
  },
  {
    _id: false,
  }
);

const availabilityDaySchema = new mongoose.Schema(
  {
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },

    enabled: {
      type: Boolean,
      default: false,
    },

    windows: {
      type: [availabilityWindowSchema],
      default: [],
    },
  },
  {
    _id: false,
  }
);

const blockedPeriodSchema = new mongoose.Schema(
  {
    startAt: {
      type: Date,
      required: true,
    },

    endAt: {
      type: Date,
      required: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 250,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const spaceSchema = new mongoose.Schema(
  {
    // ==========================================================
    // OWNERSHIP
    // ==========================================================
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ==========================================================
    // BASIC INFORMATION
    // ==========================================================
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 5000,
      default: "",
    },

    category: {
      type: String,
      enum: [
        "workspace",
        "event_center",
        "studio",
        "meeting_room",
        "conference_room",
        "training_room",
        "creative_space",
        "outdoor_space",
        "hall",
        "other",
      ],
      default: "other",
      index: true,
    },

    // ==========================================================
    // MEDIA
    // ==========================================================
    media: {
      type: [spaceMediaSchema],
      default: [],
    },

    // ==========================================================
    // CAPACITY
    // ==========================================================
    capacity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    // ==========================================================
    // LOCATION
    // ==========================================================
    location: {
      address: {
        type: String,
        trim: true,
        maxlength: 500,
        default: "",
      },

      city: {
        type: String,
        trim: true,
        maxlength: 100,
        default: "",
        index: true,
      },

      state: {
        type: String,
        trim: true,
        maxlength: 100,
        default: "",
        index: true,
      },

      country: {
        type: String,
        trim: true,
        maxlength: 100,
        default: "Nigeria",
      },

      landmark: {
        type: String,
        trim: true,
        maxlength: 250,
        default: "",
      },
    },

    // ==========================================================
    // PRICING
    // ==========================================================
    pricing: {
      type: {
        type: String,
        enum: ["hourly", "daily", "fixed"],
        default: "hourly",
      },

      amountKobo: {
        type: Number,
        required: true,
        min: 100,
      },

      minimumHours: {
        type: Number,
        min: 1,
        default: 1,
      },
    },

    // ==========================================================
    // AVAILABILITY
    // ==========================================================
    availability: {
      timezone: {
        type: String,
        trim: true,
        default: "Africa/Lagos",
      },

      slotIntervalMinutes: {
        type: Number,
        enum: [15, 30, 60],
        default: 30,
      },

      weeklySchedule: {
        type: [availabilityDaySchema],

        default: () => [
          {
            dayOfWeek: 0,
            enabled: false,
            windows: [],
          },
          {
            dayOfWeek: 1,
            enabled: true,
            windows: [
              {
                startTime: "08:00",
                endTime: "22:00",
              },
            ],
          },
          {
            dayOfWeek: 2,
            enabled: true,
            windows: [
              {
                startTime: "08:00",
                endTime: "22:00",
              },
            ],
          },
          {
            dayOfWeek: 3,
            enabled: true,
            windows: [
              {
                startTime: "08:00",
                endTime: "22:00",
              },
            ],
          },
          {
            dayOfWeek: 4,
            enabled: true,
            windows: [
              {
                startTime: "08:00",
                endTime: "22:00",
              },
            ],
          },
          {
            dayOfWeek: 5,
            enabled: true,
            windows: [
              {
                startTime: "08:00",
                endTime: "22:00",
              },
            ],
          },
          {
            dayOfWeek: 6,
            enabled: true,
            windows: [
              {
                startTime: "08:00",
                endTime: "22:00",
              },
            ],
          },
        ],
      },
    },

    // ==========================================================
    // OWNER-BLOCKED PERIODS
    // ==========================================================
    blockedPeriods: {
      type: [blockedPeriodSchema],
      default: [],
    },

    // ==========================================================
    // AMENITIES
    // ==========================================================
    amenities: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 100,
        },
      ],
      default: [],
    },

    // ==========================================================
    // RULES
    // ==========================================================
    rules: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 300,
        },
      ],
      default: [],
    },

    // ==========================================================
    // CANCELLATION
    // ==========================================================
    cancellationPolicy: {
      type: String,
      enum: ["flexible", "moderate", "strict", "custom"],
      default: "moderate",
    },

    cancellationPolicyDetails: {
      type: String,
      trim: true,
      maxlength: 1500,
      default: "",
    },

    // ==========================================================
    // MARKETPLACE STATUS
    // ==========================================================
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "draft",
      index: true,
    },

    // ==========================================================
    // METRICS
    // ==========================================================
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalBookings: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // VERIFICATION
    // ==========================================================
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },

    // ==========================================================
    // ARCHIVE
    // ==========================================================
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Owner catalogue
spaceSchema.index({
  owner: 1,
  status: 1,
  createdAt: -1,
});

// Public discovery
spaceSchema.index({
  status: 1,
  category: 1,
  createdAt: -1,
});

// Location discovery
spaceSchema.index({
  "location.state": 1,
  "location.city": 1,
  status: 1,
});

// Price discovery
spaceSchema.index({
  "pricing.amountKobo": 1,
  status: 1,
});

spaceSchema.virtual("coverImage").get(function () {
  return this.media?.find((item) => item.type === "image")?.url || "";
});

spaceSchema.virtual("isPublished").get(function () {
  return this.status === "active";
});

spaceSchema.set("toJSON", {
  virtuals: true,
});

spaceSchema.set("toObject", {
  virtuals: true,
});

module.exports = mongoose.model("Space", spaceSchema);
