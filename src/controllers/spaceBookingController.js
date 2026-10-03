const mongoose = require("mongoose");

const Space = require("../models/Space");
const SpaceBooking = require("../models/SpaceBooking");

const { checkSpaceAvailability } = require("../services/spaceAvailabilityService");

const HOLD_DURATION_MINUTES = 15;

const crypto = require("crypto");

const { initializeTransaction, verifyTransaction } = require("../services/paystackService");

const { confirmPaidSpaceBooking } = require("../services/spaceBookingPaymentService");

// ============================================================
// HELPERS
// ============================================================

function serializeBooking(booking) {
  if (!booking) return null;

  return typeof booking.toObject === "function"
    ? booking.toObject({
        virtuals: true,
      })
    : booking;
}

function getCoverImage(space) {
  if (!space?.media?.length) {
    return "";
  }

  const image = space.media.find((item) => item.type !== "video");

  return image?.url || space.media[0]?.url || "";
}

function createSpaceSnapshot(space) {
  return {
    name: space.name,

    category: space.category || "",

    coverImage: getCoverImage(space),

    location: {
      address: space.location?.address || "",
      city: space.location?.city || "",
      state: space.location?.state || "",
      country: space.location?.country || "Nigeria",
      landmark: space.location?.landmark || "",
    },
  };
}

function pushStatusHistory(booking, { status, changedBy = null, note = "" }) {
  booking.statusHistory.push({
    status,
    changedBy,
    note,
    createdAt: new Date(),
  });
}

function createHttpError(message, status = 400, code = null) {
  const error = new Error(message);

  error.status = status;

  if (code) {
    error.code = code;
  }

  return error;
}

function generateSpacePaymentReference(booking) {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `DP-SPACE-${booking._id}-` + `${Date.now()}-${randomPart}`;
}

function getFrontendUrl() {
  return String(
    process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://www.demandpoint.app"
        : "http://localhost:3000")
  ).replace(/\/$/, "");
}

async function expireBookingIfNeeded(booking) {
  if (
    booking.status === "pending_payment" &&
    booking.holdExpiresAt &&
    booking.holdExpiresAt <= new Date()
  ) {
    booking.status = "expired";
    booking.expiredAt = new Date();

    pushStatusHistory(booking, {
      status: "expired",
      note: "Payment reservation hold expired.",
    });

    await booking.save();

    return true;
  }

  return false;
}

function bookingPopulate(query) {
  return query
    .populate({
      path: "client",
      select: "name email profileImage",
    })
    .populate({
      path: "owner",
      select: "name email profileImage",
    })
    .populate({
      path: "space",
      select: "name category media location pricing capacity status verified",
    });
}

// ============================================================
// CLIENT: CREATE RESERVATION HOLD
// POST /api/space-bookings
// ============================================================

exports.createSpaceBooking = async (req, res) => {
  try {
    const { spaceId, date, startTime, endTime, guests, customerNote = "" } = req.body || {};

    if (!spaceId || !mongoose.Types.ObjectId.isValid(spaceId)) {
      return res.status(400).json({
        success: false,
        message: "Valid space ID is required.",
      });
    }

    const normalizedGuests = Number(guests);

    if (!Number.isInteger(normalizedGuests) || normalizedGuests < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of guests must be at least 1.",
      });
    }

    const space = await Space.findOne({
      _id: spaceId,
      status: "active",
    });

    if (!space) {
      return res.status(404).json({
        success: false,
        message: "Space not found.",
      });
    }

    // Owner should not reserve their own venue.
    if (String(space.owner) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot book your own space.",
      });
    }

    if (normalizedGuests > Number(space.capacity)) {
      return res.status(400).json({
        success: false,
        message: `This space has a maximum capacity of ${space.capacity} guests.`,
      });
    }

    // IMPORTANT:
    // Never trust a previous frontend availability check.
    // Always re-check immediately before creating a hold.
    const availability = await checkSpaceAvailability({
      space,
      date,
      startTime,
      endTime,
    });

    if (!availability.available) {
      return res.status(409).json({
        success: false,
        available: false,
        reason: availability.reason,
        message: availability.message,
      });
    }

    const now = new Date();

    const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60 * 1000);

    const booking = await SpaceBooking.create({
      space: space._id,

      client: req.user._id,

      owner: space.owner,

      spaceSnapshot: createSpaceSnapshot(space),

      bookingDate: date,

      startTime,

      endTime,

      startAt: availability.selection.startAt,

      endAt: availability.selection.endAt,

      timezone: space.availability?.timezone || "Africa/Lagos",

      guests: normalizedGuests,

      pricingSnapshot: {
        pricingType: availability.quote.pricingType,

        baseAmountKobo: availability.quote.baseAmountKobo,

        durationMinutes: availability.quote.durationMinutes,

        subtotalKobo: availability.quote.subtotalKobo,

        totalKobo: availability.quote.totalKobo,

        currency: availability.quote.currency,
      },

      status: "pending_payment",

      holdExpiresAt,

      payment: {
        status: "unpaid",
      },

      customerNote: String(customerNote || "").trim(),

      statusHistory: [
        {
          status: "pending_payment",
          changedBy: req.user._id,
          note: "Reservation created. Awaiting payment.",
          createdAt: now,
        },
      ],
    });

    const populated = await bookingPopulate(SpaceBooking.findById(booking._id));

    return res.status(201).json({
      success: true,

      message: "Space reserved temporarily. Complete payment before the hold expires.",

      holdDurationMinutes: HOLD_DURATION_MINUTES,

      booking: serializeBooking(populated),
    });
  } catch (error) {
    console.error("Create space booking error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to reserve this space.",
    });
  }
};

// ============================================================
// CLIENT: GET MY BOOKINGS
// GET /api/space-bookings/me
// ============================================================

exports.getMySpaceBookings = async (req, res) => {
  try {
    const { status, upcoming } = req.query;

    const query = {
      client: req.user._id,
    };

    if (
      status &&
      ["pending_payment", "confirmed", "completed", "cancelled", "expired", "declined"].includes(
        status
      )
    ) {
      query.status = status;
    }

    if (upcoming === "true") {
      query.startAt = {
        $gte: new Date(),
      };
    }

    const bookings = await bookingPopulate(
      SpaceBooking.find(query).sort({
        startAt: -1,
      })
    );

    // Mark expired holds during retrieval.
    for (const booking of bookings) {
      await expireBookingIfNeeded(booking);
    }

    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings: bookings.map(serializeBooking),
    });
  } catch (error) {
    console.error("Get client space bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your space bookings.",
    });
  }
};

// ============================================================
// CLIENT: INITIALIZE SPACE PAYMENT
// POST /api/space-bookings/:id/payment/initialize
// ============================================================

exports.initializeSpaceBookingPayment = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw createHttpError("Invalid booking ID.", 400, "INVALID_SPACE_BOOKING_ID");
    }

    const booking = await SpaceBooking.findOne({
      _id: req.params.id,
      client: req.user._id,
    });

    if (!booking) {
      throw createHttpError("Space booking not found.", 404, "SPACE_BOOKING_NOT_FOUND");
    }

    if (booking.payment?.status === "paid" && ["confirmed", "completed"].includes(booking.status)) {
      return res.status(200).json({
        success: true,
        alreadyPaid: true,
        message: "This space booking has already been paid.",
        booking: serializeBooking(booking),
      });
    }

    if (["cancelled", "declined"].includes(booking.status)) {
      throw createHttpError(
        `This booking cannot be paid because it is ${booking.status}.`,
        409,
        "SPACE_BOOKING_NOT_PAYABLE"
      );
    }

    /*
     * Don't initialize checkout after the hold expires.
     *
     * If a Paystack checkout had already been initialized
     * before expiry, verification/webhook can still safely
     * reconcile a late successful payment.
     */
    if (
      booking.status === "expired" ||
      !booking.holdExpiresAt ||
      booking.holdExpiresAt <= new Date()
    ) {
      throw createHttpError(
        "This reservation hold has expired. Please reserve the space again.",
        409,
        "SPACE_BOOKING_HOLD_EXPIRED"
      );
    }

    const amountKobo = Number(booking.pricingSnapshot?.totalKobo);

    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      throw createHttpError("The booking total is invalid.", 409, "INVALID_SPACE_BOOKING_TOTAL");
    }

    const email = String(req.user?.email || "").trim();

    if (!email) {
      throw createHttpError(
        "Your account does not have a valid email address.",
        409,
        "CUSTOMER_EMAIL_MISSING"
      );
    }

    /*
     * Reuse existing Paystack checkout while the hold
     * is still active.
     */
    if (
      booking.payment?.reference &&
      booking.payment?.authorizationUrl &&
      booking.payment?.status === "pending"
    ) {
      return res.status(200).json({
        success: true,

        payment: {
          reference: booking.payment.reference,

          authorizationUrl: booking.payment.authorizationUrl,

          accessCode: booking.payment.accessCode || "",

          amountKobo: Number(booking.payment.requestedAmountKobo || amountKobo),

          currency: booking.payment.currency || "NGN",

          holdExpiresAt: booking.holdExpiresAt,
        },

        booking: serializeBooking(booking),
      });
    }

    const reference = generateSpacePaymentReference(booking);

    /*
     * We'll build this frontend page in the Spaces UI
     * phase. For now Paystack can still initialize it.
     */
    const callbackUrl = `${getFrontendUrl()}` + `/spaces/payment/verify`;
    console.log("SPACE PAYMENT CALLBACK URL:", callbackUrl);
    const paystackResponse = await initializeTransaction({
      email,

      amountKobo,

      reference,

      callbackUrl,

      metadata: {
        type: "space_booking",

        bookingId: booking._id.toString(),

        spaceId: booking.space.toString(),

        customerId: req.user._id.toString(),
      },
    });
    console.log("PAYSTACK SPACE INITIALIZATION:", JSON.stringify(paystackResponse, null, 2));

    const authorizationUrl = paystackResponse?.data?.authorization_url;

    const accessCode = paystackResponse?.data?.access_code;

    const returnedReference = paystackResponse?.data?.reference || reference;

    if (!authorizationUrl) {
      throw createHttpError(
        "Paystack did not return a checkout URL.",
        502,
        "PAYSTACK_CHECKOUT_URL_MISSING"
      );
    }

    booking.payment.provider = "paystack";

    booking.payment.reference = returnedReference;

    booking.payment.status = "pending";

    booking.payment.requestedAmountKobo = amountKobo;

    booking.payment.currency = booking.pricingSnapshot?.currency || "NGN";

    booking.payment.authorizationUrl = authorizationUrl;

    booking.payment.accessCode = accessCode || "";

    booking.payment.failureReason = "";

    await booking.save();

    return res.status(200).json({
      success: true,

      payment: {
        reference: returnedReference,

        authorizationUrl,

        accessCode: accessCode || "",

        amountKobo,

        currency: booking.payment.currency,

        holdExpiresAt: booking.holdExpiresAt,
      },

      booking: serializeBooking(booking),
    });
  } catch (error) {
    console.error("Initialize space payment error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,

      code: error?.code || "SPACE_PAYMENT_INITIALIZATION_FAILED",

      message: status === 500 ? "Unable to initialize space payment at the moment." : error.message,
    });
  }
};

// ============================================================
// CLIENT: VERIFY SPACE PAYMENT
// GET /api/space-bookings/payment/verify/:reference
// ============================================================

exports.verifySpaceBookingPayment = async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();

    if (!reference) {
      throw createHttpError(
        "Payment reference is required.",
        400,
        "SPACE_PAYMENT_REFERENCE_REQUIRED"
      );
    }

    const booking = await SpaceBooking.findOne({
      "payment.reference": reference,
      client: req.user._id,
    });

    if (!booking) {
      throw createHttpError(
        "Booking for this payment was not found.",
        404,
        "SPACE_PAYMENT_BOOKING_NOT_FOUND"
      );
    }

    /*
     * Webhook may have beaten the browser callback.
     */
    if (booking.payment?.status === "paid" && ["confirmed", "completed"].includes(booking.status)) {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,

        message: "Payment has already been verified and the space booking is confirmed.",

        booking: serializeBooking(booking),
      });
    }

    const paystackResponse = await verifyTransaction(reference);

    const transaction = paystackResponse?.data;

    if (!transaction) {
      throw createHttpError(
        "Paystack did not return transaction details.",
        502,
        "PAYSTACK_TRANSACTION_MISSING"
      );
    }

    if (String(transaction.reference || "") !== reference) {
      throw createHttpError(
        "Payment reference verification failed.",
        409,
        "SPACE_PAYMENT_REFERENCE_MISMATCH"
      );
    }

    /*
     * If payment is not successful, record the
     * attempt without pretending money was received.
     */
    if (transaction.status !== "success") {
      booking.payment.status = "failed";

      booking.payment.failureReason =
        transaction.gateway_response ||
        transaction.message ||
        `Payment status: ${transaction.status}`;

      booking.payment.verifiedAt = new Date();

      await booking.save();

      throw createHttpError("Payment was not successful.", 409, "SPACE_PAYMENT_NOT_SUCCESSFUL");
    }

    const result = await confirmPaidSpaceBooking({
      bookingId: booking._id,

      transaction,

      expectedClientId: req.user._id,
    });

    if (result.needsResolution) {
      return res.status(409).json({
        success: false,

        paymentReceived: true,

        needsResolution: true,

        code: result.reason,

        message:
          "Payment was received, but the reservation could not be confirmed automatically. The payment requires resolution.",

        booking: serializeBooking(result.booking),
      });
    }

    return res.status(200).json({
      success: true,

      alreadyVerified: result.alreadyConfirmed,

      message: result.alreadyConfirmed
        ? "Payment and booking confirmation were already completed."
        : "Payment verified and space booking confirmed successfully.",

      booking: serializeBooking(result.booking),
    });
  } catch (error) {
    console.error("Verify space payment error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,

      code: error?.code || "SPACE_PAYMENT_VERIFICATION_FAILED",

      message: status === 500 ? "Unable to verify space payment at the moment." : error.message,
    });
  }
};

// ============================================================
// PAYSTACK: SPACE PAYMENT WEBHOOK
// POST /api/space-bookings/payment/webhook
// ============================================================

exports.handleSpaceBookingPaymentWebhook = async (req, res) => {
  try {
    const event = req.body;

    // Acknowledge events we do not currently handle.
    if (!event || event.event !== "charge.success") {
      return res.sendStatus(200);
    }

    const transaction = event.data;

    if (!transaction) {
      console.error("Space payment webhook: transaction data missing.");
      return res.sendStatus(200);
    }

    const reference = String(transaction.reference || "").trim();

    if (!reference) {
      console.error("Space payment webhook: reference missing.");
      return res.sendStatus(200);
    }

    /*
     * Only process Demand Point space-booking payments here.
     * This prevents this webhook from accidentally handling
     * marketplace/subscription transactions.
     */
    const metadata = transaction.metadata || {};

    if (metadata.type !== "space_booking") {
      return res.sendStatus(200);
    }

    const booking = await SpaceBooking.findOne({
      "payment.reference": reference,
    });

    if (!booking) {
      console.error(`Space payment webhook: booking not found for ${reference}`);

      return res.sendStatus(200);
    }

    /*
     * Idempotency:
     * Paystack can deliver the same webhook more than once.
     */
    if (booking.payment?.status === "paid" && ["confirmed", "completed"].includes(booking.status)) {
      return res.sendStatus(200);
    }

    /*
     * Verify directly with Paystack instead of trusting
     * webhook payload transaction details alone.
     */
    const paystackResponse = await verifyTransaction(reference);

    const verifiedTransaction = paystackResponse?.data;

    if (!verifiedTransaction) {
      console.error(
        `Space payment webhook: Paystack verification returned no transaction for ${reference}`
      );

      return res.sendStatus(200);
    }

    if (
      String(verifiedTransaction.reference || "") !== reference ||
      verifiedTransaction.status !== "success"
    ) {
      console.error(`Space payment webhook: transaction verification failed for ${reference}`);

      return res.sendStatus(200);
    }

    const result = await confirmPaidSpaceBooking({
      bookingId: booking._id,
      transaction: verifiedTransaction,
      expectedClientId: booking.client,
    });

    if (result.needsResolution) {
      console.error(
        `Space payment webhook requires resolution for booking ${booking._id}:`,
        result.reason
      );

      return res.sendStatus(200);
    }

    console.log(`Space payment webhook confirmed booking ${booking._id} (${reference})`);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Space payment webhook error:", error);

    /*
     * Return 500 for unexpected failures so Paystack
     * can retry delivery.
     */
    return res.sendStatus(500);
  }
};

// ============================================================
// OWNER: GET RESERVATIONS
// GET /api/space-bookings/owner/me
// ============================================================

exports.getOwnerSpaceBookings = async (req, res) => {
  try {
    const { status, upcoming } = req.query;

    const query = {
      owner: req.user._id,
    };

    if (
      status &&
      ["pending_payment", "confirmed", "completed", "cancelled", "expired", "declined"].includes(
        status
      )
    ) {
      query.status = status;
    }

    if (upcoming === "true") {
      query.startAt = {
        $gte: new Date(),
      };
    }

    const bookings = await bookingPopulate(
      SpaceBooking.find(query).sort({
        startAt: 1,
      })
    );

    for (const booking of bookings) {
      await expireBookingIfNeeded(booking);
    }

    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings: bookings.map(serializeBooking),
    });
  } catch (error) {
    console.error("Get owner space bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve space reservations.",
    });
  }
};

// ============================================================
// CLIENT / OWNER: GET ONE BOOKING
// GET /api/space-bookings/:id
// ============================================================

exports.getSpaceBookingById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await bookingPopulate(SpaceBooking.findById(req.params.id));

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    const userId = String(req.user._id);

    const isClient = String(booking.client?._id) === userId;

    const isOwner = String(booking.owner?._id) === userId;

    if (!isClient && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this booking.",
      });
    }

    await expireBookingIfNeeded(booking);

    return res.status(200).json({
      success: true,
      booking: serializeBooking(booking),
    });
  } catch (error) {
    console.error("Get space booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this booking.",
    });
  }
};

// ============================================================
// CLIENT: CANCEL BOOKING
// PATCH /api/space-bookings/:id/cancel
// ============================================================

exports.cancelSpaceBooking = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await SpaceBooking.findOne({
      _id: req.params.id,
      client: req.user._id,
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    if (booking.payment?.status === "paid" || booking.status === "confirmed") {
      return res.status(409).json({
        success: false,
        code: "PAID_BOOKING_REFUND_REQUIRED",
        message: "Paid space bookings require the refund workflow before cancellation.",
      });
    }

    await expireBookingIfNeeded(booking);

    if (booking.status !== "pending_payment") {
      return res.status(400).json({
        success: false,
        message: `This booking cannot be cancelled because it is ${booking.status}.`,
      });
    }

    if (booking.startAt <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "A booking that has already started cannot be cancelled.",
      });
    }

    const { reason = "" } = req.body || {};

    booking.status = "cancelled";

    booking.holdExpiresAt = null;

    booking.cancellation = {
      cancelledBy: req.user._id,
      reason: String(reason || "").trim(),
      cancelledAt: new Date(),
    };

    pushStatusHistory(booking, {
      status: "cancelled",
      changedBy: req.user._id,
      note: String(reason || "").trim() || "Booking cancelled by client.",
    });

    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Space booking cancelled successfully.",
      booking: serializeBooking(booking),
    });
  } catch (error) {
    console.error("Cancel space booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel this booking.",
    });
  }
};

// ============================================================
// OWNER: DECLINE BOOKING
// PATCH /api/space-bookings/:id/decline
// ============================================================

exports.declineSpaceBooking = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await SpaceBooking.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    await expireBookingIfNeeded(booking);

    if (booking.status !== "pending_payment") {
      return res.status(400).json({
        success: false,
        message: `This booking cannot be declined because it is ${booking.status}.`,
      });
    }

    if (booking.startAt <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "A booking that has already started cannot be declined.",
      });
    }

    const { reason = "" } = req.body || {};

    booking.status = "declined";
    booking.holdExpiresAt = null;

    pushStatusHistory(booking, {
      status: "declined",
      changedBy: req.user._id,
      note: String(reason || "").trim() || "Booking declined by space owner.",
    });

    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Space booking declined successfully.",
      booking: serializeBooking(booking),
    });
  } catch (error) {
    console.error("Decline space booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to decline this booking.",
    });
  }
};

// ============================================================
// OWNER: COMPLETE BOOKING
// PATCH /api/space-bookings/:id/complete
// ============================================================

exports.completeSpaceBooking = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await SpaceBooking.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    if (booking.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Only confirmed bookings can be completed.",
      });
    }

    if (booking.endAt > new Date()) {
      return res.status(400).json({
        success: false,
        message: "This booking cannot be completed before its scheduled end time.",
      });
    }

    booking.status = "completed";
    booking.completedAt = new Date();
    booking.holdExpiresAt = null;

    pushStatusHistory(booking, {
      status: "completed",
      changedBy: req.user._id,
      note: "Space booking marked as completed.",
    });

    await booking.save();

    // Successful completed reservations contribute
    // to the space's booking history.
    await Space.updateOne(
      {
        _id: booking.space,
      },
      {
        $inc: {
          totalBookings: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Space booking completed successfully.",
      booking: serializeBooking(booking),
    });
  } catch (error) {
    console.error("Complete space booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to complete this booking.",
    });
  }
};
