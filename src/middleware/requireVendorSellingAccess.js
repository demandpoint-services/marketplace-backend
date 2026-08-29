const VendorProfile = require("../models/VendorProfile");

const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const { getSubscriptionAccess } = require("../utils/subscriptionStatus");

async function requireVendorSellingAccess(req, res, next) {
  try {
    if (req.user?.role !== "artisan") {
      return res.status(403).json({
        success: false,
        code: "ARTISAN_REQUIRED",
        message: "Only artisan accounts can sell products.",
      });
    }

    const vendor = await VendorProfile.findOne({
      user: req.user._id,
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        code: "VENDOR_PROFILE_REQUIRED",
        message: "Complete vendor onboarding before selling products.",
      });
    }

    if (!vendor.onboardingCompleted) {
      return res.status(403).json({
        success: false,
        code: "VENDOR_ONBOARDING_INCOMPLETE",
        message: "Complete your vendor profile before selling products.",
      });
    }

    if (vendor.status !== "active") {
      return res.status(403).json({
        success: false,
        code: "VENDOR_NOT_ACTIVE",
        message:
          vendor.status === "suspended"
            ? "Your vendor account is currently suspended."
            : "Your vendor account is currently inactive.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    const access = getSubscriptionAccess(subscription);

    if (!access.canSellProducts) {
      return res.status(403).json({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        message:
          access.restrictionMessage ||
          "An active DemandPoint Professional subscription is required to sell products.",
        access,
      });
    }

    req.vendor = vendor;
    req.subscription = subscription;
    req.subscriptionAccess = access;

    return next();
  } catch (error) {
    console.error("Vendor selling access error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify vendor selling access.",
    });
  }
}

module.exports = requireVendorSellingAccess;
