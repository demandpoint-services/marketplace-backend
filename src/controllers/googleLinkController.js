const { validIdentity, hasGoogleSubjectIndex } = require("./googleAuthController");

const FRESH_GOOGLE_TOKEN_SECONDS = 5 * 60;
const GOOGLE_CLOCK_SKEW_SECONDS = 30;

function createGoogleLink({ User, googleClient, getAudience, verifySession, comparePassword, buildSafeUser }) {
  return async function googleLink(req, res) {
    res.set("Cache-Control", "no-store");
    const fail = (status, code, message) => res.status(status).json({ success: false, code, message });
    const expiredSession = () =>
      fail(401, "GOOGLE_SESSION_EXPIRED", "Sign in to DemandPoint again before linking Google.");
    const reauth = () =>
      fail(401, "GOOGLE_REAUTH_REQUIRED", "Confirm your current DemandPoint password to link Google.");
    const conflict = () =>
      fail(409, "GOOGLE_IDENTITY_CONFLICT", "This Google identity cannot be linked to this account.");
    const suspended = () =>
      fail(403, "GOOGLE_ACCOUNT_SUSPENDED", "Your account has been suspended.");
    const unavailable = () =>
      fail(503, "GOOGLE_LINK_UNAVAILABLE", "Google linking is temporarily unavailable.");

    const bearer = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "")?.[1];
    if (!bearer) return expiredSession();

    let session;
    try {
      session = verifySession(bearer);
    } catch {
      return expiredSession();
    }
    const sessionIsCurrent = () => Number.isFinite(session?.exp) && session.exp > Date.now() / 1000;
    if (!sessionIsCurrent() || typeof session.id !== "string" || !/^[a-f0-9]{24}$/i.test(session.id)) {
      return expiredSession();
    }

    const { password, credential } = req.body ?? {};
    if (typeof credential !== "string" || !credential.trim()) {
      return fail(400, "GOOGLE_CREDENTIAL_REQUIRED", "Google credential is required.");
    }
    const audience = getAudience()?.trim();
    if (!audience) return unavailable();

    try {
      const user = await User.findById(session.id).select("email googleId password isSuspended").lean();
      if (!user) return expiredSession();
      if (user.isSuspended) return suspended();
      if (typeof user.password !== "string" || !user.password) {
        return fail(409, "GOOGLE_REAUTH_UNAVAILABLE", "This account requires a separate recovery proof before linking.");
      }
      if (typeof password !== "string" || !password || !(await comparePassword(password, user.password))) {
        return reauth();
      }

      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience });
        payload = ticket.getPayload();
      } catch {
        return fail(401, "GOOGLE_INVALID_CREDENTIAL", "Google could not verify this account.");
      }
      if (!validIdentity(payload, audience)) {
        return fail(401, "GOOGLE_INVALID_CREDENTIAL", "Google could not verify this account.");
      }
      const googleTokenIsFresh = () => {
        const now = Date.now() / 1000;
        return Number.isFinite(payload.iat) &&
          payload.iat <= now + GOOGLE_CLOCK_SKEW_SECONDS &&
          now - payload.iat <= FRESH_GOOGLE_TOKEN_SECONDS &&
          payload.iat < payload.exp && payload.exp > now;
      };
      const staleCredential = () =>
        fail(401, "GOOGLE_CREDENTIAL_STALE", "Start Google sign-in again to obtain a fresh credential.");
      if (!googleTokenIsFresh()) return staleCredential();

      const subject = payload.sub;
      if (
        typeof user.email !== "string" ||
        user.email.trim().toLowerCase() !== payload.email.trim().toLowerCase() ||
        (user.googleId != null && user.googleId !== subject)
      ) return conflict();

      const other = await User.exists({ googleId: subject, _id: { $ne: user._id } })
        .collation({ locale: "simple" });
      if (other) return conflict();
      if (!hasGoogleSubjectIndex(await User.listIndexes())) return unavailable();
      if (!sessionIsCurrent()) return expiredSession();
      if (!googleTokenIsFresh()) return staleCredential();

      // Recheck the proof and identity at write time. The unique index arbitrates races across accounts.
      const linked = await User.findOneAndUpdate({
        _id: user._id,
        password: user.password,
        email: user.email,
        isSuspended: { $ne: true },
        $expr: { $or: [
          { $in: [{ $type: "$googleId" }, ["missing", "null"]] },
          { $eq: ["$googleId", { $literal: subject }] },
        ] },
      }, { $set: { googleId: subject } }, {
        returnDocument: "after",
        collation: { locale: "simple" },
      });

      if (linked) return res.status(200).json({ success: true, user: buildSafeUser(linked) });

      const current = await User.findById(session.id).select("email googleId password isSuspended").lean();
      if (!current) return expiredSession();
      if (current.isSuspended) return suspended();
      if (current.password !== user.password) return reauth();
      return conflict();
    } catch (error) {
      if (error?.code === 11000) return conflict();
      // Verification and driver errors can contain sensitive request or identity details.
      return unavailable();
    }
  };
}

module.exports = { createGoogleLink };
