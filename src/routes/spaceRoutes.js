const express = require("express");

const router = express.Router();

const {
  createSpace,
  getSpaces,
  getSpaceById,
  getMySpaces,
  getMySpaceById,
  updateSpace,
  archiveSpace,
  updateSpaceAvailability,
  addBlockedPeriod,
  removeBlockedPeriod,
  getSpaceAvailability,
} = require("../controllers/spaceController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

// ============================================================
// OWNER CATALOGUE
// ============================================================

router.get("/owner/me", protect, artisanOnly, getMySpaces);

router.get("/owner/me/:id", protect, artisanOnly, getMySpaceById);

// ============================================================
// CREATE
// ============================================================

router.post("/", protect, artisanOnly, createSpace);

// ============================================================
// OWNER AVAILABILITY MANAGEMENT
// ============================================================

router.patch("/:id/availability", protect, artisanOnly, updateSpaceAvailability);

router.post("/:id/blocked-periods", protect, artisanOnly, addBlockedPeriod);

router.delete("/:id/blocked-periods/:blockedPeriodId", protect, artisanOnly, removeBlockedPeriod);

// ============================================================
// PUBLIC AVAILABILITY
// ============================================================

router.get("/:id/availability", getSpaceAvailability);

// ============================================================
// UPDATE / ARCHIVE
// ============================================================

router.patch("/:id", protect, artisanOnly, updateSpace);

router.delete("/:id", protect, artisanOnly, archiveSpace);

// ============================================================
// PUBLIC
// ============================================================

router.get("/", getSpaces);

router.get("/:id", getSpaceById);

module.exports = router;
