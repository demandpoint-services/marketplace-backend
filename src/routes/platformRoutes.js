const express = require("express");
const { getPublicPlatformStats } = require("../controllers/platformController");

const router = express.Router();

/**
 * @route   GET /api/platform/stats
 * @desc    Get public Demand Point marketplace statistics
 * @access  Public
 */
router.get("/stats", getPublicPlatformStats);

module.exports = router;
