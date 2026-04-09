const express = require("express");
const router = express.Router();

const {
  createProfile,
  getArtisans,
  getArtisan,
  updateProfile,
} = require("../controllers/artisanController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

// Public
router.get("/", getArtisans);
router.get("/:id", getArtisan);

// Protected artisan routes
router.post("/", protect, artisanOnly, createProfile);
router.put("/", protect, artisanOnly, updateProfile);

module.exports = router;
