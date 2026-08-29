const express = require("express");

const {
  initializeOrderPayment,
  verifyOrderPayment,
} = require("../controllers/paymentController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/initialize", protect, initializeOrderPayment);

router.get("/verify/:reference", protect, verifyOrderPayment);

module.exports = router;
