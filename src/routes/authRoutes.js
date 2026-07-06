const express = require("express");
const router = express.Router();
const {
  register,
  login,
  googleLogin,
  verifyEmail,
  resendVerification,
} = require("../controllers/authController");

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);

module.exports = router;
