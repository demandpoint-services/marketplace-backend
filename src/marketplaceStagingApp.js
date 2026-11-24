const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomBytes } = require("node:crypto");
const { DATABASE } = require("./config/marketplaceStaging");
const { ChatError, failure, objectId } = require("./services/marketplaceStagingChat");

const issuer = "demandpoint-marketplace-integration-staging";
const audience = "demandpoint-marketplace-chat-staging";
const emailPattern = /^chat-(client|artisan|unrelated|suspended)@demandpoint\.test$/;
const synthetic = { marketplaceChatFixture: "stage-1b-v1" };

function limiter({ max, interval, capacity = 2048, clock = Date.now }) {
  const entries = new Map();
  return function consume(key) {
    const now = clock();
    let entry = entries.get(key);
    if (!entry || entry.until <= now) {
      if (entries.size >= capacity) {
        for (const [id, record] of entries) if (record.until <= now) entries.delete(id);
        if (entries.size >= capacity && !entries.has(key)) return Math.ceil(interval / 1000);
      }
      entry = { until: now + interval, hits: 0 };
      entries.set(key, entry);
    }
    if (entry.hits >= max) return Math.ceil((entry.until - now) / 1000);
    entry.hits++;
    return 0;
  };
}

function enforceLimit(res, remaining) {
  if (!remaining) return;
  res.set("Retry-After", String(remaining));
  throw failure(429, "RATE_LIMITED", "Try again later.");
}

function safeUser({ _id, name, email, profileImage, role, isVerified, isSuspended, profileCompleted }) {
  return { _id, name, email, profileImage, role, isVerified, isSuspended, profileCompleted };
}

function createMarketplaceStagingApp({ users, chat, secret, clock, trustProxy = false }) {
  const app = express();
  const dummyHash = bcrypt.hashSync(randomBytes(24).toString("hex"), 10);
  const loginLimit = limiter({ max: 10, interval: 60000, clock });
  const accountLimit = limiter({ max: 20, interval: 60000, clock, capacity: 8 });
  const sendLimit = limiter({ max: 40, interval: 60000, clock });
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.get("/", (_req, res) => res.json({ service: issuer, database: DATABASE, status: "ok" }));
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use("/api", express.json({ limit: "12kb" }));

  app.post("/api/auth/login", async (req, res) => {
    enforceLimit(res, loginLimit(req.ip ?? "unknown"));
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;
    if (emailPattern.test(email)) enforceLimit(res, accountLimit(email));
    const user = emailPattern.test(email) ? await users.findOne({ ...synthetic, email }) : null;
    const valid = typeof password === "string" && password.length <= 72 && password.length > 0 &&
      await bcrypt.compare(password, user?.password ?? dummyHash);
    if (!valid || !user || user.isSuspended || !user.profileCompleted || !user.isVerified ||
        !["client", "artisan"].includes(user.role)) {
      throw failure(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
    const token = jwt.sign({ id: String(user._id) }, secret, { algorithm: "HS256", issuer, audience, expiresIn: "1h" });
    res.json({ success: true, token, user: safeUser(user) });
  });

  async function protect(req, _res, next) {
    let id;
    try {
      const header = /^Bearer ([\w.-]{1,2048})$/.exec(req.get("authorization") ?? "");
      if (!header) throw new Error();
      const claims = jwt.verify(header[1], secret, { algorithms: ["HS256"], issuer, audience, maxAge: "1h" });
      if (!Number.isSafeInteger(claims.exp)) throw new Error();
      id = objectId(claims.id);
    } catch {
      throw failure(401, "INVALID_SESSION", "Sign in to marketplace staging.");
    }
    const user = await users.findOne({ ...synthetic, _id: id }, { projection: { password: 0 } });
    if (!user || !emailPattern.test(user.email) || !user.isVerified || !user.profileCompleted ||
        !["client", "artisan"].includes(user.role)) throw failure(401, "INVALID_SESSION", "Sign in to marketplace staging.");
    if (user.isSuspended) throw failure(403, "ACCOUNT_SUSPENDED", "This account is suspended.");
    req.user = user;
    next();
  }

  app.get("/api/users/me", protect, (req, res) => res.json(safeUser(req.user)));
  const api = express.Router();
  api.get("/conversations", protect, async (req, res) => res.json({ success: true, ...await chat.list(req.user._id) }));
  api.get("/unread-count", protect, async (req, res) => res.json({ success: true, unreadCount: await chat.unread(req.user._id) }));
  api.get("/conversations/:id", protect, async (req, res) =>
    res.json({ success: true, conversation: await chat.detail(objectId(req.params.id), req.user._id) }));
  api.get("/conversations/:id/messages", protect, async (req, res) =>
    res.json({ success: true, ...await chat.history(objectId(req.params.id), req.user._id, req.query) }));
  api.post("/conversations/:id/messages", protect, async (req, res) => {
    enforceLimit(res, sendLimit(String(req.user._id)));
    const result = await chat.send(objectId(req.params.id), req.user._id, req.body);
    res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
  });
  api.patch("/conversations/:id/read", protect, async (req, res) => {
    const boundary = req.body?.throughMessageId;
    res.json({ success: true, ...await chat.markRead(objectId(req.params.id), req.user._id,
      boundary === undefined ? undefined : objectId(boundary)) });
  });
  api.post("/bookings/:id/conversation", protect, async (req, res) =>
    res.json({ success: true, conversation: await chat.open(objectId(req.params.id), req.user._id) }));
  app.use("/api/messages", api);
  app.use((_req, res) => res.status(404).json({ success: false, code: "NOT_FOUND", message: "Route not found." }));
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed") return res.status(400).json({ success: false, code: "INVALID_JSON" });
    if (error.type === "entity.too.large") return res.status(413).json({ success: false, code: "PAYLOAD_TOO_LARGE" });
    if (error instanceof ChatError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Staging request failed." });
  });
  return app;
}

module.exports = { createMarketplaceStagingApp, issuer, audience, limiter, synthetic };
