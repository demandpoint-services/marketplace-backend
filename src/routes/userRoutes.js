const express = require("express");
const router = express.Router();

const {
  setupAccount,
  getMe,
  updateMe,
  deleteMe,
  toggleSuspension,
} = require("../controllers/userController");

const { protect } = require("../middleware/authMiddleware");
const updatePresence = require("../middleware/updatePresence");

// All routes below require authentication
router.use(protect);

// Update lastSeen after authentication
router.use(updatePresence);

router.post("/setup-account", setupAccount);

router.get("/me", getMe);

router.put("/me", updateMe);

router.delete("/me", deleteMe);

router.put("/toggle-suspension", toggleSuspension);

module.exports = router;
