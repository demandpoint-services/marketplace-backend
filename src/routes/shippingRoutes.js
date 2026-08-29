const express = require("express");

const { getShippingQuote } = require("../controllers/shippingController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Calculate delivery for the authenticated customer's cart.
 */
router.post("/quote", protect, getShippingQuote);

module.exports = router;
