const mongoose = require("mongoose");

const Space = require("../models/Space");

const {
  validateWeeklySchedule,
  checkSpaceAvailability,
} = require("../services/spaceAvailabilityService");

const ALLOWED_CATEGORIES = new Set([
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
]);

const ALLOWED_PRICING_TYPES = new Set(["hourly", "daily", "fixed"]);

const ALLOWED_CANCELLATION_POLICIES = new Set(["flexible", "moderate", "strict", "custom"]);

// ============================================================
// HELPERS
// ============================================================

function normalizeMedia(media = []) {
  if (!Array.isArray(media)) {
    return [];
  }

  return media
    .map((item) => {
      if (typeof item === "string") {
        const url = item.trim();

        if (!url) return null;

        return {
          url,
          publicId: "",
          alt: "",
          type: "image",
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const url = String(item.url || "").trim();

      if (!url) {
        return null;
      }

      const type = item.type === "video" ? "video" : "image";

      return {
        url,
        publicId: String(item.publicId || "").trim(),
        alt: String(item.alt || "").trim(),
        type,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeStringArray(values = [], limit = 30) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(
    0,
    limit
  );
}

function normalizeLocation(location = {}) {
  if (!location || typeof location !== "object") {
    return {
      address: "",
      city: "",
      state: "",
      country: "Nigeria",
      landmark: "",
    };
  }

  return {
    address: String(location.address || "").trim(),
    city: String(location.city || "").trim(),
    state: String(location.state || "").trim(),
    country: String(location.country || "").trim() || "Nigeria",
    landmark: String(location.landmark || "").trim(),
  };
}

function normalizePricing(pricing = {}) {
  const type = ALLOWED_PRICING_TYPES.has(pricing?.type) ? pricing.type : "hourly";

  const amountKobo = Number(pricing?.amountKobo);

  const minimumHours = Number(pricing?.minimumHours ?? 1);

  if (!Number.isFinite(amountKobo) || amountKobo < 100) {
    throw new Error("Enter a valid space price.");
  }

  if (!Number.isInteger(minimumHours) || minimumHours < 1) {
    throw new Error("Minimum hours must be at least 1.");
  }

  return {
    type,
    amountKobo: Math.round(amountKobo),
    minimumHours,
  };
}

function serializeSpace(space) {
  if (!space) return null;

  const value =
    typeof space.toObject === "function"
      ? space.toObject({
          virtuals: true,
        })
      : space;

  return value;
}

function escapeRegex(value) {
  return String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// CREATE SPACE
// POST /api/spaces
// ============================================================

exports.createSpace = async (req, res) => {
  try {
    const {
      name,
      description = "",
      category = "other",
      media = [],
      capacity,
      location = {},
      pricing = {},
      amenities = [],
      rules = [],
      cancellationPolicy = "moderate",
      cancellationPolicyDetails = "",
      status = "draft",
    } = req.body || {};

    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
      return res.status(400).json({
        success: false,
        message: "Space name is required.",
      });
    }

    const normalizedCategory = String(category || "other")
      .trim()
      .toLowerCase();

    if (!ALLOWED_CATEGORIES.has(normalizedCategory)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space category.",
      });
    }

    const normalizedCapacity = Number(capacity);

    if (!Number.isInteger(normalizedCapacity) || normalizedCapacity < 1) {
      return res.status(400).json({
        success: false,
        message: "Space capacity must be at least 1.",
      });
    }

    const normalizedLocation = normalizeLocation(location);

    if (!normalizedLocation.city || !normalizedLocation.state) {
      return res.status(400).json({
        success: false,
        message: "Space city and state are required.",
      });
    }

    let normalizedPricing;

    try {
      normalizedPricing = normalizePricing(pricing);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const normalizedCancellationPolicy = ALLOWED_CANCELLATION_POLICIES.has(cancellationPolicy)
      ? cancellationPolicy
      : "moderate";

    const normalizedStatus = status === "active" ? "active" : "draft";

    const space = await Space.create({
      owner: req.user._id,

      name: normalizedName,

      description: String(description || "").trim(),

      category: normalizedCategory,

      media: normalizeMedia(media),

      capacity: normalizedCapacity,

      location: normalizedLocation,

      pricing: normalizedPricing,

      amenities: normalizeStringArray(amenities, 40),

      rules: normalizeStringArray(rules, 30),

      cancellationPolicy: normalizedCancellationPolicy,

      cancellationPolicyDetails: String(cancellationPolicyDetails || "").trim(),

      status: normalizedStatus,
    });

    const populated = await Space.findById(space._id).populate({
      path: "owner",
      select: "name profileImage location isVerified",
    });

    return res.status(201).json({
      success: true,
      message:
        normalizedStatus === "active" ? "Space published successfully." : "Space saved as draft.",
      space: serializeSpace(populated),
    });
  } catch (error) {
    console.error("Create space error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to create space.",
    });
  }
};

// ============================================================
// OWNER: GET MY SPACES
// GET /api/spaces/owner/me
// ============================================================

exports.getMySpaces = async (req, res) => {
  try {
    const spaces = await Space.find({
      owner: req.user._id,
    }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      spaces: spaces.map(serializeSpace),
    });
  } catch (error) {
    console.error("Get my spaces error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your spaces.",
    });
  }
};

// ============================================================
// OWNER: GET ONE
// GET /api/spaces/owner/me/:id
// ============================================================

exports.getMySpaceById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    return res.status(200).json({
      success: true,
      space: serializeSpace(space),
    });
  } catch (error) {
    console.error("Get owner space error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this space.",
    });
  }
};

// ============================================================
// OWNER: UPDATE AVAILABILITY
// PATCH /api/spaces/:id/availability
// ============================================================

exports.updateSpaceAvailability = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    const { weeklySchedule, slotIntervalMinutes } = req.body || {};

    let normalizedSchedule;

    try {
      normalizedSchedule = validateWeeklySchedule(weeklySchedule);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const interval = Number(slotIntervalMinutes ?? 30);

    if (![15, 30, 60].includes(interval)) {
      return res.status(400).json({
        success: false,
        message: "Slot interval must be 15, 30 or 60 minutes.",
      });
    }

    space.availability = {
      timezone: "Africa/Lagos",
      slotIntervalMinutes: interval,
      weeklySchedule: normalizedSchedule,
    };

    await space.save();

    return res.status(200).json({
      success: true,
      message: "Space availability updated successfully.",
      availability: space.availability,
    });
  } catch (error) {
    console.error("Update space availability error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update space availability.",
    });
  }
};

// ============================================================
// OWNER: BLOCK PERIOD
// POST /api/spaces/:id/blocked-periods
// ============================================================

exports.addBlockedPeriod = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    const { startAt, endAt, reason = "" } = req.body || {};

    const normalizedStart = new Date(startAt);

    const normalizedEnd = new Date(endAt);

    if (Number.isNaN(normalizedStart.getTime()) || Number.isNaN(normalizedEnd.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Valid startAt and endAt values are required.",
      });
    }

    if (normalizedEnd <= normalizedStart) {
      return res.status(400).json({
        success: false,
        message: "Blocked period end time must be later than start time.",
      });
    }

    space.blockedPeriods.push({
      startAt: normalizedStart,
      endAt: normalizedEnd,
      reason: String(reason || "").trim(),
    });

    await space.save();

    const blockedPeriod = space.blockedPeriods[space.blockedPeriods.length - 1];

    return res.status(201).json({
      success: true,
      message: "Blocked period added successfully.",
      blockedPeriod,
    });
  } catch (error) {
    console.error("Add blocked period error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to block this period.",
    });
  }
};

// ============================================================
// OWNER: REMOVE BLOCKED PERIOD
// DELETE /api/spaces/:id/blocked-periods/:blockedPeriodId
// ============================================================

exports.removeBlockedPeriod = async (req, res) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(req.params.id) ||
      !mongoose.Types.ObjectId.isValid(req.params.blockedPeriodId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid space or blocked period ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    const blockedPeriod = space.blockedPeriods.id(req.params.blockedPeriodId);

    if (!blockedPeriod) {
      return res.status(404).json({
        success: false,
        message: "Blocked period not found.",
      });
    }

    blockedPeriod.deleteOne();

    await space.save();

    return res.status(200).json({
      success: true,
      message: "Blocked period removed successfully.",
    });
  } catch (error) {
    console.error("Remove blocked period error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to remove blocked period.",
    });
  }
};

// ============================================================
// PUBLIC: GET SPACES
// GET /api/spaces
// ============================================================

exports.getSpaces = async (req, res) => {
  try {
    const {
      category,
      search,
      city,
      state,
      minCapacity,
      minPrice,
      maxPrice,
      sort = "newest",
      verified,
    } = req.query;

    const query = {
      status: "active",
    };

    if (category && category !== "all") {
      const normalizedCategory = String(category).trim().toLowerCase();

      if (ALLOWED_CATEGORIES.has(normalizedCategory)) {
        query.category = normalizedCategory;
      }
    }

    if (city) {
      query["location.city"] = {
        $regex: `^${escapeRegex(city)}$`,
        $options: "i",
      };
    }

    if (state) {
      query["location.state"] = {
        $regex: `^${escapeRegex(state)}$`,
        $options: "i",
      };
    }

    if (minCapacity !== undefined) {
      const capacity = Number(minCapacity);

      if (Number.isFinite(capacity) && capacity > 0) {
        query.capacity = {
          $gte: capacity,
        };
      }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      query["pricing.amountKobo"] = {};

      const minimum = Number(minPrice);
      const maximum = Number(maxPrice);

      if (minPrice !== undefined && Number.isFinite(minimum) && minimum >= 0) {
        query["pricing.amountKobo"].$gte = minimum;
      }

      if (maxPrice !== undefined && Number.isFinite(maximum) && maximum >= 0) {
        query["pricing.amountKobo"].$lte = maximum;
      }

      if (Object.keys(query["pricing.amountKobo"]).length === 0) {
        delete query["pricing.amountKobo"];
      }
    }

    if (verified === "true") {
      query.verified = true;
    }

    if (search) {
      const escaped = escapeRegex(search);

      query.$or = [
        {
          name: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          description: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          category: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          "location.city": {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          "location.state": {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          amenities: {
            $regex: escaped,
            $options: "i",
          },
        },
      ];
    }

    const sortOptions = {
      newest: {
        createdAt: -1,
      },

      price_asc: {
        "pricing.amountKobo": 1,
        createdAt: -1,
      },

      price_desc: {
        "pricing.amountKobo": -1,
        createdAt: -1,
      },

      rating: {
        rating: -1,
        reviewCount: -1,
        createdAt: -1,
      },

      capacity: {
        capacity: -1,
        createdAt: -1,
      },
    };

    const selectedSort = sortOptions[sort] || sortOptions.newest;

    const spaces = await Space.find(query)
      .populate({
        path: "owner",
        select: "name profileImage location isVerified",
      })
      .sort(selectedSort);

    return res.status(200).json({
      success: true,
      count: spaces.length,
      spaces: spaces.map(serializeSpace),
    });
  } catch (error) {
    console.error("Get spaces error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve spaces.",
    });
  }
};

// ============================================================
// PUBLIC: GET SPACE
// GET /api/spaces/:id
// ============================================================

exports.getSpaceById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      status: "active",
    }).populate({
      path: "owner",
      select: "name profileImage location isVerified",
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    return res.status(200).json({
      success: true,
      space: serializeSpace(space),
    });
  } catch (error) {
    console.error("Get space error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this space.",
    });
  }
};

// ============================================================
// PUBLIC: CHECK AVAILABILITY + GET QUOTE
// GET /api/spaces/:id/availability
// ============================================================

exports.getSpaceAvailability = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const { date, startTime, endTime } = req.query;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "date, startTime and endTime are required.",
      });
    }

    const space = await Space.findById(req.params.id);

    if (!space || space.status !== "active") {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    const result = await checkSpaceAvailability({
      space,
      date,
      startTime,
      endTime,
    });

    return res.status(200).json({
      success: true,
      spaceId: space._id,
      ...result,
    });
  } catch (error) {
    console.error("Check space availability error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to check space availability.",
    });
  }
};

// ============================================================
// UPDATE SPACE
// PATCH /api/spaces/:id
// ============================================================

exports.updateSpace = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    const {
      name,
      description,
      category,
      media,
      capacity,
      location,
      pricing,
      amenities,
      rules,
      cancellationPolicy,
      cancellationPolicyDetails,
      status,
    } = req.body || {};

    // ============================================================
    // BASIC INFORMATION
    // ============================================================

    if (name !== undefined) {
      const normalizedName = String(name).trim();

      if (!normalizedName) {
        return res.status(400).json({
          success: false,
          message: "Space name cannot be empty.",
        });
      }

      space.name = normalizedName;
    }

    if (description !== undefined) {
      space.description = String(description || "").trim();
    }

    if (category !== undefined) {
      const normalizedCategory = String(category).trim().toLowerCase();

      if (!ALLOWED_CATEGORIES.has(normalizedCategory)) {
        return res.status(400).json({
          success: false,
          message: "Invalid space category.",
        });
      }

      space.category = normalizedCategory;
    }

    // ============================================================
    // MEDIA
    // ============================================================

    if (media !== undefined) {
      space.media = normalizeMedia(media);
    }

    // ============================================================
    // CAPACITY
    // ============================================================

    if (capacity !== undefined) {
      const normalizedCapacity = Number(capacity);

      if (!Number.isInteger(normalizedCapacity) || normalizedCapacity < 1) {
        return res.status(400).json({
          success: false,
          message: "Space capacity must be at least 1.",
        });
      }

      space.capacity = normalizedCapacity;
    }

    // ============================================================
    // LOCATION
    // ============================================================

    if (location !== undefined) {
      const normalizedLocation = normalizeLocation(location);

      if (!normalizedLocation.city || !normalizedLocation.state) {
        return res.status(400).json({
          success: false,
          message: "Space city and state are required.",
        });
      }

      space.location = normalizedLocation;
    }

    // ============================================================
    // PRICING
    // ============================================================

    if (pricing !== undefined) {
      try {
        space.pricing = normalizePricing(pricing);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
    }

    // ============================================================
    // AMENITIES / RULES
    // ============================================================

    if (amenities !== undefined) {
      space.amenities = normalizeStringArray(amenities, 40);
    }

    if (rules !== undefined) {
      space.rules = normalizeStringArray(rules, 30);
    }

    // ============================================================
    // CANCELLATION
    // ============================================================

    if (cancellationPolicy !== undefined) {
      if (!ALLOWED_CANCELLATION_POLICIES.has(cancellationPolicy)) {
        return res.status(400).json({
          success: false,
          message: "Invalid cancellation policy.",
        });
      }

      space.cancellationPolicy = cancellationPolicy;
    }

    if (cancellationPolicyDetails !== undefined) {
      space.cancellationPolicyDetails = String(cancellationPolicyDetails || "").trim();
    }

    // ============================================================
    // STATUS
    // ============================================================

    if (status !== undefined) {
      if (!["draft", "active"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Space status must be draft or active.",
        });
      }

      space.status = status;
      space.archivedAt = null;
    }

    await space.save();

    const populated = await Space.findById(space._id).populate({
      path: "owner",
      select: "name profileImage location isVerified",
    });

    return res.status(200).json({
      success: true,
      message: "Space updated successfully.",
      space: serializeSpace(populated),
    });
  } catch (error) {
    console.error("Update space error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to update space.",
    });
  }
};

// ============================================================
// ARCHIVE SPACE
// DELETE /api/spaces/:id
// ============================================================

exports.archiveSpace = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid space ID.",
      });
    }

    const space = await Space.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    if (space.status === "archived") {
      return res.status(200).json({
        success: true,
        message: "Space is already archived.",
        space: serializeSpace(space),
      });
    }

    space.status = "archived";
    space.archivedAt = new Date();

    await space.save();

    return res.status(200).json({
      success: true,
      message: "Space archived successfully.",
      space: serializeSpace(space),
    });
  } catch (error) {
    console.error("Archive space error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to archive space.",
    });
  }
};
