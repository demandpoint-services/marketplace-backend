const {
  processSubscriptionMaintenance,
} = require("../services/subscriptionMaintenanceService");

exports.runSubscriptionMaintenance = async (req, res) => {
  try {
    const suppliedSecret = req.headers["x-maintenance-secret"];

    if (
      !process.env.SUBSCRIPTION_MAINTENANCE_SECRET ||
      suppliedSecret !== process.env.SUBSCRIPTION_MAINTENANCE_SECRET
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized maintenance request.",
      });
    }

    const result = await processSubscriptionMaintenance();

    return res.status(200).json({
      success: true,
      message: "Subscription maintenance completed.",
      result,
    });
  } catch (error) {
    console.error("Subscription maintenance error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to run subscription maintenance.",
    });
  }
};
