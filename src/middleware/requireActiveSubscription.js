const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const {
  hasActiveArtisanAccess,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

async function requireActiveSubscription(req, res, next) {
  try {
    if (req.user?.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Artisan access only.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    const subscriptionData = serializeSubscription(subscription);

    if (!hasActiveArtisanAccess(subscription)) {
      return res.status(403).json({
        success: false,

        code: "SUBSCRIPTION_REQUIRED",

        message:
          "Your DemandPoint Professional subscription is inactive. Renew your subscription to continue.",

        subscription: subscriptionData,
      });
    }

    req.subscription = subscription;

    return next();
  } catch (error) {
    console.error("Subscription access error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify subscription access.",
    });
  }
}

module.exports = requireActiveSubscription;
