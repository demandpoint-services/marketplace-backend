const express = require("express");
const router = express.Router();

const {
  setupAccount,
  getMe,
  updateMe,
  deleteMe,
} = require("../controllers/userController");

const { protect } = require("../middleware/authMiddleware");

router.post("/setup-account", protect, setupAccount);

router.get("/me", protect, getMe);

router.put("/me", protect, updateMe);

router.delete("/me", protect, deleteMe);

module.exports = router;
