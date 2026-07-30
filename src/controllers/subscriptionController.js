const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const {
  isSubscriptionPaymentRequired,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

exports.getMySubscription = async (req, res) => {
  try {
    if (req.user.role !== "artisan") {
      return res.status(200).json({
        success: true,

        subscriptionApplies: false,

        subscriptionRequired: false,

        subscription: null,

        message: "Client accounts do not require a subscription.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    return res.status(200).json({
      success: true,

      subscriptionApplies: true,

      subscriptionRequired: isSubscriptionPaymentRequired(subscription),

      subscription: serializeSubscription(subscription),
    });
  } catch (error) {
    console.error("Get subscription error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve subscription details.",
    });
  }
};
