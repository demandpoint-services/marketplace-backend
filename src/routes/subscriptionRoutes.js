const express = require("express");

const router = express.Router();

const {
  getMySubscription,
  initializeSubscriptionPayment,
  verifySubscriptionPayment,
} = require("../controllers/subscriptionController");

const { protect } = require("../middleware/authMiddleware");

router.get("/me", protect, getMySubscription);

router.post("/initialize", protect, initializeSubscriptionPayment);

router.get("/verify/:reference", protect, verifySubscriptionPayment);

module.exports = router;
