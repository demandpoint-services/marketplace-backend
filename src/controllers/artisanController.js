const cloudinary = require("../config/cloudinary");
const ArtisanProfile = require("../models/ArtisanProfile");
const User = require("../models/User");
const isUserOnline = require("../utils/isUserOnline");
const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const Subscription = require("../models/Subscription");

const {
  getSubscriptionAccess,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

// Create artisan profile
exports.createProfile = async (req, res) => {
  try {
    const {
      category,
      skills,
      minimumCharge,
      hourlyRate,
      yearsOfExperience,
      serviceAreas,
    } = req.body;

    if (!category?.trim()) {
      return res.status(400).json({
        message: "Service category is required",
      });
    }

    const existing = await ArtisanProfile.findOne({
      user: req.user._id,
    });

    if (existing) {
      return res.status(400).json({
        message: "Profile already exists",
      });
    }

    const profile = await ArtisanProfile.create({
      user: req.user._id,
      category: category.trim(),
      skills: Array.isArray(skills) ? skills : [],
      minimumCharge: Number(minimumCharge) || 0,
      hourlyRate: Number(hourlyRate) || 0,
      yearsOfExperience: Number(yearsOfExperience) || 0,
      serviceAreas: Array.isArray(serviceAreas) ? serviceAreas : [],
    });

    await User.findByIdAndUpdate(req.user._id, {
      role: "artisan",
    });

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    const populatedProfile = await ArtisanProfile.findById(
      profile._id,
    ).populate("user", "name email phone profileImage bio location isVerified");

    return res.status(201).json({
      profile: populatedProfile,

      subscription: serializeSubscription(subscription),
    });
  } catch (error) {
    console.error("Create artisan profile error:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Get all active artisans
exports.getArtisans = async (req, res) => {
  try {
    const artisans = await ArtisanProfile.find()
      .populate(
        "user",
        "name email phone profileImage bio location isVerified isSuspended createdAt lastSeen",
      )
      .sort({ createdAt: -1 });

    const artisanUserIds = artisans
      .filter((artisan) => artisan.user)
      .map((artisan) => artisan.user._id);

    const subscriptions = await Subscription.find({
      user: {
        $in: artisanUserIds,
      },
    });

    const subscriptionMap = new Map(
      subscriptions.map((subscription) => [
        String(subscription.user),
        subscription,
      ]),
    );

    const visibleArtisans = artisans
      .filter((artisan) => {
        if (!artisan.user || artisan.user.isSuspended === true) {
          return false;
        }

        const subscription = subscriptionMap.get(String(artisan.user._id));

        const access = getSubscriptionAccess(subscription);

        return access.isVisibleInMarketplace;
      })
      .map((artisan) => {
        const artisanObject = artisan.toObject();

        const subscription = subscriptionMap.get(String(artisan.user._id));

        return {
          ...artisanObject,
          online: isUserOnline(artisan.user.lastSeen),
          subscription: serializeSubscription(subscription),
          marketplaceAccess: getSubscriptionAccess(subscription),
        };
      });

    return res.status(200).json(visibleArtisans);
  } catch (error) {
    console.error("Get artisans error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to retrieve artisans.",
    });
  }
};

// Get a single artisan
exports.getArtisan = async (req, res) => {
  try {
    const artisan = await ArtisanProfile.findById(req.params.id).populate(
      "user",
      "name email phone profileImage bio location isVerified isSuspended createdAt lastSeen",
    );

    if (!artisan || !artisan.user || artisan.user.isSuspended) {
      return res.status(404).json({
        success: false,
        message: "Artisan not found.",
      });
    }

    const subscription = await Subscription.findOne({
      user: artisan.user._id,
    });

    const access = getSubscriptionAccess(subscription);

    if (!access.isVisibleInMarketplace) {
      return res.status(404).json({
        success: false,
        code: "ARTISAN_UNAVAILABLE",
        message: "This professional is currently unavailable.",
      });
    }

    return res.status(200).json({
      ...artisan.toObject(),
      online: isUserOnline(artisan.user.lastSeen),
      subscription: serializeSubscription(subscription),
      marketplaceAccess: access,
    });
  } catch (error) {
    console.error("Get artisan error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to retrieve artisan.",
    });
  }
};

// Get current artisan profile
exports.getMyArtisanProfile = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({
      user: req.user._id,
    }).populate(
      "user",
      "name email phone profileImage bio location isVerified createdAt",
    );

    if (!profile) {
      return res.status(404).json({
        message: "Artisan profile not found",
      });
    }

    return res.status(200).json(profile);
  } catch (err) {
    console.error("Get artisan profile error:", err);

    return res.status(500).json({
      message: err.message,
    });
  }
};

// Update artisan profile
exports.updateProfile = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({
      user: req.user._id,
    });

    if (!profile) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    const allowedUpdates = [
      "category",
      "skills",
      "minimumCharge",
      "hourlyRate",
      "yearsOfExperience",
      "serviceAreas",
      "available",
      "responseTime",
    ];

    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        profile[field] = req.body[field];
      }
    }

    await profile.save();

    const updated = await ArtisanProfile.findById(profile._id).populate(
      "user",
      "name email phone profileImage bio location isVerified createdAt",
    );

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Update artisan profile error:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};
