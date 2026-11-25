const { createHash } = require("node:crypto");
const { ObjectId } = require("mongodb");
const { chatCollection, failure, objectId } = require("./marketplaceStagingChat");
const { normalizeBookingStatus, transitions } = require("./bookingTransitions");

const bookingEvent = {
  accepted: "accepted", declined: "declined", in_progress: "started", awaiting_confirmation: "completion_requested",
  cancelled: "cancelled", completed: "completed",
};
const synthetic = { marketplaceChatFixture: "stage-1b-v1" };
const serviceFixture = { marketplaceChatFixture: "stage-2-v1" };
const bookingScope = { marketplaceChatFixture: { $in: [synthetic.marketplaceChatFixture, serviceFixture.marketplaceChatFixture] } };
const personProjection = { name: 1, role: 1, profileImage: 1 };
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max + 1) : "";
const bad = message => failure(400, "INVALID_BOOKING", message);

function createMarketplaceServices(db, mongo) {
  const bookings = chatCollection(db, "bookings");
  const artisans = chatCollection(db, "artisanprofiles");
  const users = chatCollection(db, "users");
  const notifications = db.collection("marketplace_service_notifications");
  const tx = work => mongo.withSession(session => session.withTransaction(() => work(session), {
    readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
  }));
  async function notice({ recipient, bookingId, conversationId, type, title, createdAt = new Date() }, session) {
    await notifications.insertOne({ recipient, bookingId, conversationId, type, title, createdAt, isRead: false }, { session });
  }
  function person(id) {
    return users.findOne({ ...synthetic, _id: id }, { projection: personProjection });
  }
  function profile(id, session) {
    return artisans.findOne({ ...synthetic, _id: id }, { session });
  }
  async function publicProfile(row, includeReviews = false) {
    const user = await users.findOne({ ...synthetic, _id: row.user, isSuspended: { $ne: true } }, { projection: personProjection });
    if (!user) return null;
    const rated = await bookings.find({ ...bookingScope, artisan: row._id, "review.rating": { $exists: true } })
      .project({ review: 1, client: 1 }).sort({ "review.createdAt": -1, _id: -1 }).toArray();
    return { _id: row._id, name: user.name, user, category: row.category, skills: row.skills ?? [],
      description: row.description, location: row.location, serviceAreas: row.serviceAreas, portfolio: row.portfolio,
      hourlyRate: row.hourlyRate, minimumCharge: row.minimumCharge,
      isAvailable: row.available ?? row.isAvailable, isVerified: row.verified ?? row.isVerified,
      reviewCount: rated.length, rating: rated.length ? rated.reduce((sum, item) => sum + item.review.rating, 0) / rated.length : undefined,
      reviews: includeReviews ? await Promise.all(rated.slice(0, 20).map(async item => ({
        ...item.review, client: await person(item.client),
      }))) : undefined };
  }
  function ownerFilter(user) {
    return user.role === "artisan"
      ? artisans.distinct("_id", { ...synthetic, user: user._id }).then(ids => ({ artisan: { $in: ids } }))
      : Promise.resolve({ client: user._id });
  }
  async function owned(id, user, session) {
    const row = await bookings.findOne({ ...bookingScope, _id: id }, { session });
    if (!row) throw failure(404, "NOT_FOUND", "Booking not found.");
    const artisan = await profile(row.artisan, session);
    const owns = user.role === "artisan" ? artisan?.user?.equals(user._id) : row.client.equals(user._id);
    if (!owns) throw failure(404, "NOT_FOUND", "Booking not found.");
    return { row, artisan };
  }
  async function view(row, artisan) {
    const { _id, service, date, time, address, notes, status, price, statusHistory, review, conversation } = row;
    return { _id, service, date, time, address, notes, price, status: normalizeBookingStatus(status), statusHistory, review, conversation,
      client: await person(row.client), artisan: artisan ? { _id: artisan._id, category: artisan.category, user: await person(artisan.user) } : null };
  }
  async function detail(id, user) {
    const { row, artisan } = await owned(id, user);
    return view(row, artisan);
  }
  return {
    notice,
    async catalog() {
      const rows = await artisans.find(synthetic).sort({ _id: 1 }).limit(100).toArray();
      return (await Promise.all(rows.map(publicProfile))).filter(Boolean).map(({ reviews, ...row }) => row);
    },
    async professional(id) {
      const row = await profile(id);
      const result = row && await publicProfile(row, true);
      if (!result) throw failure(404, "NOT_FOUND", "Professional not found.");
      return result;
    },
    async list(user, before) {
      const filter = { ...bookingScope, ...await ownerFilter(user), ...(before ? { _id: { $lt: objectId(before) } } : {}) };
      const rows = await bookings.find(filter).sort({ _id: -1 }).limit(31).toArray();
      const page = rows.slice(0, 30);
      return { bookings: await Promise.all(page.map(async row => view(row, await profile(row.artisan)))),
        nextCursor: rows.length > 30 ? String(page.at(-1)._id) : null };
    },
    detail,
    async create(user, body = {}) {
      if (user.role !== "client") throw failure(403, "CLIENT_REQUIRED", "Only clients can request services.");
      const key = body.clientMutationId;
      if (typeof key !== "string" || !/^[\w-]{16,80}$/.test(key)) throw bad("A request identifier is required.");
      const artisanId = objectId(body.artisan);
      const service = text(body.service, 160);
      const day = text(body.date, 10);
      const time = text(body.time, 5);
      const address = text(body.address, 500);
      const notes = text(body.notes, 2000);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
          !address || address.length > 500 || notes.length > 2000) throw bad("Check your date, time, address and notes.");
      const date = new Date(day + "T00:00:00.000Z");
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw bad("Choose a valid date.");
      const requestHash = createHash("sha256").update(JSON.stringify([String(artisanId), service, day, time, address, notes])).digest("hex");
      const replay = row => {
        if (!row || row.requestHash !== requestHash) throw failure(409, "MUTATION_CONFLICT", "This request identifier was used for another booking.");
        return { row, replayed: true };
      };
      const filter = { ...serviceFixture, client: user._id, clientMutationId: key };
      let result;
      try {
        result = await tx(async session => {
          const existing = await bookings.findOne(filter, { session });
          if (existing) return replay(existing);
          const artisan = await profile(artisanId, session);
          const offered = artisan?.skills?.length ? artisan.skills : [artisan?.category];
          if (!artisan || !offered.includes(service)) throw bad("Choose a service offered by this staging professional.");
          if (!await users.findOne({ ...synthetic, _id: artisan.user, role: "artisan", isSuspended: { $ne: true }, isVerified: true }, { session, projection: { _id: 1 } }) || (artisan.available ?? artisan.isAvailable) === false) throw bad("This professional is currently unavailable.");
          const now = new Date();
          if (new Date(day + "T" + time + ":00+01:00") <= now) throw bad("Choose a future date and time in Nigeria time.");
          const row = { _id: new ObjectId(), ...filter, artisan: artisanId, service, date, time, address, notes, requestHash,
            status: "pending", statusHistory: [{ status: "pending", changedAt: now, actorRole: "client" }],
            createdAt: now, updatedAt: now };
          await bookings.insertOne(row, { session });
          await notice({ recipient: artisan.user, bookingId: row._id, type: "booking_created", title: "New booking request", createdAt: now }, session);
          return { row, replayed: false };
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        result = replay(await bookings.findOne(filter));
      }
      return { booking: await view(result.row, await profile(result.row.artisan)), replayed: result.replayed };
    },
    async update(id, user, status) {
      await tx(async session => {
        const { row, artisan } = await owned(id, user, session);
        const current = normalizeBookingStatus(row.status);
        if (status === current) return;
        if (!transitions[user.role]?.[current]?.includes(status)) throw failure(409, "INVALID_TRANSITION", "This booking action is no longer available.");
        const now = new Date();
        await bookings.updateOne({ _id: id }, {
          $set: { status, updatedAt: now },
          $push: { statusHistory: { status, changedAt: now, actorRole: user.role } },
        }, { session });
        await notice({ recipient: user.role === "client" ? artisan.user : row.client, bookingId: id,
          type: "booking_" + bookingEvent[status], title: "Booking " + status.replaceAll("_", " "), createdAt: now }, session);
      });
      return detail(id, user);
    },
    async review(id, user, rating, feedback) {
      const comment = text(feedback, 1500);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1500) throw bad("Give a rating and write feedback up to 1,500 characters.");
      return tx(async session => {
        const { row } = await owned(id, user, session);
        if (user.role !== "client" || row.status !== "completed") throw failure(403, "REVIEW_INELIGIBLE", "Only the client can review a completed booking.");
        if (row.review) throw failure(409, "REVIEW_EXISTS", "This booking already has a review.");
        const review = { _id: new ObjectId(), rating, comment, createdAt: new Date() };
        await bookings.updateOne({ _id: id }, { $set: { review } }, { session });
        return { review };
      });
    },
    async notifications(user, before) {
      const recipient = user._id;
      const filter = { recipient, ...(before ? { _id: { $lt: objectId(before) } } : {}) };
      const rows = await notifications.find(filter).sort({ _id: -1 }).limit(31).toArray();
      return { notifications: rows.slice(0, 30).map(({ recipient: _recipient, ...row }) => row),
        nextCursor: rows.length > 30 ? String(rows[29]._id) : null };
    },
    unread: user => notifications.countDocuments({ recipient: user._id, isRead: false }),
    async read(user, id) {
      const filter = { recipient: user._id, isRead: false, ...(id ? { _id: id } : {}) };
      await notifications.updateMany(filter, { $set: { isRead: true } });
    },
  };
}

module.exports = { createMarketplaceServices };
