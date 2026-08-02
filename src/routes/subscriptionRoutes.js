const express = require("express");

const router = express.Router();

const {
  getMySubscription,
  initializeSubscriptionPayment,
  verifySubscriptionPayment,
  handlePaystackWebhook,
  cancelAutomaticRenewal,
} = require("../controllers/subscriptionController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

/*
 * Public Paystack route.
 */
router.post("/webhook/paystack", handlePaystackWebhook);

router.get("/me", protect, artisanOnly, getMySubscription);

router.post("/initialize", protect, artisanOnly, initializeSubscriptionPayment);

router.get(
  "/verify/:reference",
  protect,
  artisanOnly,
  verifySubscriptionPayment,
);

router.patch("/cancel-renewal", protect, cancelAutomaticRenewal);

module.exports = router;
