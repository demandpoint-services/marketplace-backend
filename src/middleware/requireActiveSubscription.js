const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const {
  getSubscriptionAccess,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

async function requireActiveSubscription(req, res, next) {
  try {
    if (req.user?.role !== "artisan") {
      return res.status(403).json({
        success: false,
        code: "ARTISAN_ACCESS_ONLY",
        message: "Artisan access only.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);
    const access = getSubscriptionAccess(subscription);

    if (!access.hasAccess) {
      return res.status(403).json({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        message: access.restrictionMessage,
        subscription: serializeSubscription(subscription),
        access,
      });
    }

    req.subscription = subscription;
    req.subscriptionAccess = access;

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
