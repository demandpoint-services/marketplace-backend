const express = require("express");

const router = express.Router();

const { getMySubscription } = require("../controllers/subscriptionController");

const { protect } = require("../middleware/authMiddleware");

router.get("/me", protect, getMySubscription);

module.exports = router;
