const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

function validIdentity(payload, audience) {
  return (
    payload?.aud === audience &&
    GOOGLE_ISSUERS.has(payload.iss) &&
    Number.isFinite(payload.exp) &&
    payload.exp > Date.now() / 1000 &&
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    payload.sub.length <= 255 &&
    payload.sub.trim() === payload.sub &&
    typeof payload.email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim()) &&
    payload.email_verified === true
  );
}

function googleIsAuthoritative(payload, email) {
  return email.endsWith("@gmail.com") ||
    (typeof payload.hd === "string" && Boolean(payload.hd.trim()));
}

function hasUniqueKey(indexes, field, matchesFilter) {
  return indexes.some((index) =>
    index.unique === true &&
    !index.sparse &&
    (!index.collation || index.collation.locale === "simple") &&
    Object.keys(index.key).length === 1 &&
    index.key[field] === 1 &&
    matchesFilter(index.partialFilterExpression),
  );
}

function hasGoogleSubjectIndex(indexes) {
  return hasUniqueKey(indexes, "googleId", (filter) =>
    filter &&
    Object.keys(filter).length === 1 &&
    filter.googleId &&
    Object.keys(filter.googleId).length === 1 &&
    filter.googleId.$type === "string",
  );
}

function hasIdentityIndexes(indexes) {
  return hasUniqueKey(indexes, "email", (filter) => !filter) && hasGoogleSubjectIndex(indexes);
}

function createGoogleLogin({
  User, googleClient, getAudience, generateToken, buildSafeUser, onNewUser,
}) {
  return async function googleLogin(req, res) {
    const fail = (status, code, message) =>
      res.status(status).json({ success: false, code, message });
    const unavailable = () =>
      fail(503, "GOOGLE_AUTH_UNAVAILABLE", "Google sign-in is temporarily unavailable.");

    const credential = req.body?.credential;
    if (typeof credential !== "string" || !credential.trim()) {
      return fail(400, "GOOGLE_CREDENTIAL_REQUIRED", "Google credential is required.");
    }

    const audience = getAudience()?.trim();
    if (!audience) return unavailable();

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

    const email = payload.email.trim().toLowerCase();
    const googleId = payload.sub;
    const signedIn = (user) => {
      if (user.isSuspended) {
        return fail(403, "GOOGLE_ACCOUNT_SUSPENDED", "Your account has been suspended.");
      }
      return res.status(200).json({
        success: true,
        token: generateToken(user._id),
        user: buildSafeUser(user),
      });
    };

    async function findBySubject() {
      const users = await User.find({ googleId }).collation({ locale: "simple" }).limit(2);
      if (users.length > 1 || (users[0] && users[0].googleId !== googleId)) {
        return fail(409, "GOOGLE_IDENTITY_CONFLICT", "This Google identity requires account support.");
      }
      return users.length === 1 ? signedIn(users[0]) : null;
    }

    async function findExisting() {
      const linked = await findBySubject();
      if (linked) return linked;
      // Registration stores normalized email. Also account for pre-normalization records.
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, (character) => "\\" + character);
      const legacyEmail = new RegExp("^\\s*" + escaped + "\\s*$", "i");
      if (await User.exists({ email: legacyEmail }).collation({ locale: "simple" })) {
        // A concurrent request may have created this subject since the first read.
        return (await findBySubject()) ?? fail(409, "GOOGLE_LINK_REQUIRED", "Sign in to your existing account or contact support to link Google.");
      }
      return null;
    }

    try {
      const existing = await findExisting();
      if (existing) return existing;

      if (!googleIsAuthoritative(payload, email)) {
        return fail(403, "GOOGLE_EMAIL_VERIFICATION_REQUIRED",
          "Use email registration to verify this address before linking Google.");
      }

      // Returning users can sign in before the index rollout. Creation needs both database constraints.
      if (!hasIdentityIndexes(await User.listIndexes())) return unavailable();

      let user;
      try {
        user = await User.create({
          name: (typeof payload.name === "string" && payload.name.trim()) || "DemandPoint User",
          email,
          googleId,
          provider: "google",
          profileImage: typeof payload.picture === "string" ? payload.picture : "",
          isVerified: true,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const winner = await findExisting();
        return winner ?? unavailable();
      }

      await onNewUser(user);
      return signedIn(user);
    } catch {
      // Driver and token-library errors can contain identity or credential data.
      return unavailable();
    }
  };
}

module.exports = { createGoogleLogin, validIdentity, hasGoogleSubjectIndex };
