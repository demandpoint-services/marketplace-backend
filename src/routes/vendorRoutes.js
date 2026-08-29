const express = require("express");

const router = express.Router();

const { protect, artisanOnly } = require("../middleware/authMiddleware");

const {
  getMyVendorProfile,
  createVendorProfile,
  updateMyVendorProfile,
} = require("../controllers/vendorController");

router.get("/me", protect, artisanOnly, getMyVendorProfile);

router.post("/onboard", protect, artisanOnly, createVendorProfile);

router.patch("/me", protect, artisanOnly, updateMyVendorProfile);

module.exports = router;
