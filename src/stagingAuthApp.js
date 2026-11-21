const express = require("express");

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

function createApp({ googleLogin, googleLink, protect }) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/", (_req, res) => res.json({ service: "demandpoint-staging-auth", status: "ok" }));

  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const readJson = express.json({ limit: "16kb" });
  app.post("/api/auth/google", readJson, googleLogin);
  app.post("/api/auth/google/link", readJson, googleLink);
  app.get("/api/users/me", protect, (req, res) => res.json(buildSafeUser(req.user)));

  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON." });
    if (error.type === "entity.too.large") return res.status(413).json({ message: "Request too large." });
    return res.status(500).json({ message: "Staging request failed." });
  });

  return app;
}

function createStagingAuthApp({ audience, secret }) {
  const bcrypt = require("bcryptjs");
  const jwt = require("jsonwebtoken");
  const { OAuth2Client } = require("google-auth-library");
  const User = require("./models/User");
  const { protect } = require("./middleware/authMiddleware");
  const { createGoogleLogin } = require("./controllers/googleAuthController");
  const { createGoogleLink } = require("./controllers/googleLinkController");

  const google = { User, googleClient: new OAuth2Client(audience), getAudience: () => audience, buildSafeUser };
  return createApp({
    protect,
    googleLogin: createGoogleLogin({
      ...google,
      generateToken: id => jwt.sign({ id }, secret, { expiresIn: "7d" }),
      onNewUser: async () => {},
    }),
    googleLink: createGoogleLink({
      ...google,
      verifySession: token => jwt.verify(token, secret),
      comparePassword: bcrypt.compare,
    }),
  });
}

module.exports = { createApp, createStagingAuthApp };
