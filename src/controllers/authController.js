const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const User = require("../models/User");
const sendVerificationEmail = require("../utils/sendVerificationEmail");

const { createNotification } = require("../services/notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const VERIFICATION_CODE_DURATION_MS = 10 * 60 * 1000;
const PASSWORD_MINIMUM_LENGTH = 6;

/**
 * Generate a signed authentication token.
 */
function generateToken(userId) {
  return jwt.sign(
    {
      id: userId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );
}

/**
 * Generate a cryptographically secure six-digit code.
 */
function generateVerificationCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Return the public user fields allowed in authentication responses.
 */
function buildSafeUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    bio: user.bio,
    location: user.location,
    profileImage: user.profileImage,
    profileCompleted: user.profileCompleted,
    isVerified: user.isVerified,
    isSuspended: user.isSuspended,
    provider: user.provider,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Produce a one-way identifier representing the current browser and network.
 *
 * This should be treated as an approximate security signal rather than a
 * guaranteed unique device identifier.
 */
function createLoginFingerprint(req) {
  const userAgent = req.get("user-agent") || "unknown";
  const forwardedFor = req.headers["x-forwarded-for"];

  const ip =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip || "unknown";

  return crypto.createHash("sha256").update(`${userAgent}:${ip}`).digest("hex");
}

/**
 * Create a notification without allowing notification failure to break the
 * primary account operation.
 */
async function createNotificationSafely(payload, context) {
  try {
    return await createNotification(payload);
  } catch (error) {
    console.error(`${context} notification error:`, error);
    return null;
  }
}

/**
 * Attempt to send a verification email.
 */
async function sendVerificationEmailSafely(email, code, context) {
  try {
    await sendVerificationEmail(email, code);
    return true;
  } catch (error) {
    console.error(`${context} verification email error:`, error);
    return false;
  }
}

/**
 * Register a local account.
 */
exports.register = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < PASSWORD_MINIMUM_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Password must be at least ${PASSWORD_MINIMUM_LENGTH} characters.`,
      });
    }

    const existingUser = await User.findOne({ email }).select("_id");

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account already exists with this email address.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationCode = generateVerificationCode();

    const user = await User.create({
      name,
      email,
      password: passwordHash,
      provider: "local",
      isVerified: false,
      verificationCode,
      verificationExpires: new Date(Date.now() + VERIFICATION_CODE_DURATION_MS),
    });

    const verificationEmailSent = await sendVerificationEmailSafely(
      user.email,
      verificationCode,
      "Registration",
    );

    return res.status(201).json({
      success: true,
      message: verificationEmailSent
        ? "Account created. Check your email for the verification code."
        : "Account created, but the verification email could not be sent. Request a new code to continue.",
      verificationEmailSent,
      token: generateToken(user._id),
      user: buildSafeUser(user),
    });
  } catch (error) {
    console.error("Register error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account already exists with this email address.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create your account. Please try again.",
    });
  }
};

/**
 * Authenticate a local account.
 */
exports.login = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        message:
          "This account uses Google Sign-In. Please continue with Google.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        message:
          "Your account has been suspended. Contact support for assistance.",
      });
    }

    const loginFingerprint = createLoginFingerprint(req);

    const isNewLogin =
      Boolean(user.lastLoginFingerprint) &&
      user.lastLoginFingerprint !== loginFingerprint;

    user.lastLoginAt = new Date();
    user.lastLoginFingerprint = loginFingerprint;

    await user.save();

    if (isNewLogin) {
      await createNotificationSafely(
        {
          recipient: user._id,
          type: NOTIFICATION_TYPES.LOGIN_DETECTED,
          category: NOTIFICATION_CATEGORIES.SECURITY,
          title: "New login detected",
          message:
            "Your DemandPoint account was accessed from a new device or network.",
          actionUrl: "/settings?section=security",
          resourceType: "user",
          resourceId: user._id,
          metadata: {
            userAgent: req.get("user-agent") || "",
          },
        },
        "Login",
      );
    }

    return res.status(200).json({
      success: true,
      token: generateToken(user._id),
      user: buildSafeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to log in. Please try again.",
    });
  }
};

/**
 * Authenticate or create a Google account.
 */
exports.googleLogin = async (req, res) => {
  try {
    const credential = req.body.credential;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required.",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email || payload.email_verified !== true) {
      return res.status(401).json({
        success: false,
        message: "Google could not verify this account.",
      });
    }

    const email = payload.email.trim().toLowerCase();

    let user = await User.findOne({ email });
    const isNewUser = !user;

    if (user?.isSuspended) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended.",
      });
    }

    if (!user) {
      user = await User.create({
        name: payload.name?.trim() || "DemandPoint User",
        email,
        googleId: payload.sub,
        provider: "google",
        profileImage: payload.picture || "",
        isVerified: true,
        verificationCode: undefined,
        verificationExpires: undefined,
      });
    } else {
      /*
       * Link Google to the existing account without removing the user's local
       * password. A local user may therefore continue using either method.
       */
      user.googleId = payload.sub;
      user.isVerified = true;
      user.verificationCode = undefined;
      user.verificationExpires = undefined;

      if (!user.password) {
        user.provider = "google";
      }

      if (!user.profileImage && payload.picture) {
        user.profileImage = payload.picture;
      }

      await user.save();
    }

    if (isNewUser) {
      await createNotificationSafely(
        {
          recipient: user._id,
          type: NOTIFICATION_TYPES.EMAIL_VERIFIED,
          category: NOTIFICATION_CATEGORIES.SECURITY,
          title: "Google account verified",
          message: "Your email address was verified through Google Sign-In.",
          actionUrl: "/settings?section=security",
          resourceType: "user",
          resourceId: user._id,
        },
        "Google verification",
      );
    }

    return res.status(200).json({
      success: true,
      token: generateToken(user._id),
      user: buildSafeUser(user),
    });
  } catch (error) {
    console.error("Google login error:", error);

    return res.status(401).json({
      success: false,
      message: "Google authentication failed.",
    });
  }
};

/**
 * Verify a local user's email.
 */
exports.verifyEmail = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const code = req.body.code?.trim();

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: "The verification code must contain six digits.",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,
        message: "Email is already verified.",
        user: buildSafeUser(user),
      });
    }

    const codeExpired =
      !user.verificationExpires ||
      user.verificationExpires.getTime() <= Date.now();

    const codeInvalid =
      !user.verificationCode || user.verificationCode !== code;

    if (codeInvalid || codeExpired) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code.",
      });
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationExpires = undefined;

    await user.save();

    await createNotificationSafely(
      {
        recipient: user._id,
        type: NOTIFICATION_TYPES.EMAIL_VERIFIED,
        category: NOTIFICATION_CATEGORIES.SECURITY,
        title: "Email verified",
        message: "Your email address was verified successfully.",
        actionUrl: "/settings?section=security",
        resourceType: "user",
        resourceId: user._id,
      },
      "Email verification",
    );

    return res.status(200).json({
      success: true,
      message: "Email verified successfully.",
      user: buildSafeUser(user),
    });
  } catch (error) {
    console.error("Verify email error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify email. Please try again.",
    });
  }
};

/**
 * Send a replacement email-verification code.
 */
exports.resendVerification = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,
        message: "Email is already verified.",
        user: buildSafeUser(user),
      });
    }

    const verificationCode = generateVerificationCode();

    user.verificationCode = verificationCode;
    user.verificationExpires = new Date(
      Date.now() + VERIFICATION_CODE_DURATION_MS,
    );

    await user.save();

    const verificationEmailSent = await sendVerificationEmailSafely(
      user.email,
      verificationCode,
      "Resend",
    );

    if (!verificationEmailSent) {
      return res.status(502).json({
        success: false,
        message:
          "We could not send the verification email. Please try again shortly.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent.",
    });
  } catch (error) {
    console.error("Resend verification error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to resend the verification code.",
    });
  }
};
