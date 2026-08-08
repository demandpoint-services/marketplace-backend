const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const ArtisanProfile = require("../models/ArtisanProfile");
const User = require("../models/User");

const { createNotification } = require("../services/notificationService");
const { notifyBookingEvent } = require("../services/bookingCommunicationService");
const { getSubscriptionForUser } = require("../services/subscriptionService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");
const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

const {
  getSubscriptionAccess,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

const ARTISAN_STATUS_TRANSITIONS = Object.freeze({
  pending: ["accepted", "declined"],
  accepted: ["in_progress"],
  in_progress: ["awaiting_confirmation"],
  "in-progress": ["awaiting_confirmation"],
  awaiting_confirmation: [],
  completed: [],
  declined: [],
  cancelled: [],
});

const CLIENT_STATUS_TRANSITIONS = Object.freeze({
  pending: ["cancelled"],
  accepted: ["cancelled"],
  in_progress: [],
  "in-progress": [],
  awaiting_confirmation: ["completed"],
  completed: [],
  declined: [],
  cancelled: [],
});

function normalizeBookingStatus(status) {
  if (!status) return "";

  const normalized = String(status).trim().toLowerCase();

  return normalized === "in-progress" ? "in_progress" : normalized;
}

function applyLifecycleTimestamp(booking, status, actorRole) {
  const now = new Date();

  switch (status) {
    case "accepted":
      booking.acceptedAt = booking.acceptedAt || now;
      break;
    case "declined":
      booking.declinedAt = booking.declinedAt || now;
      break;
    case "in_progress":
      booking.startedAt = booking.startedAt || now;
      break;
    case "awaiting_confirmation":
      booking.completionRequestedAt = booking.completionRequestedAt || now;
      break;
    case "completed":
      booking.completedAt = booking.completedAt || now;
      break;
    case "cancelled":
      booking.cancelledAt = booking.cancelledAt || now;
      booking.cancelledBy = actorRole;
      break;
    default:
      break;
  }

  return now;
}

function appendStatusHistory(booking, { status, actorId, actorRole, changedAt }) {
  booking.statusHistory = Array.isArray(booking.statusHistory)
    ? booking.statusHistory
    : [];

  booking.statusHistory.push({
    status,
    changedAt,
    changedBy: actorId,
    actorRole,
  });
}

function ensureLegacyStatusHistory(booking, previousStatus) {
  booking.statusHistory = Array.isArray(booking.statusHistory)
    ? booking.statusHistory
    : [];

  if (booking.statusHistory.length > 0) {
    return;
  }

  if (booking.createdAt) {
    booking.statusHistory.push({
      status: "pending",
      changedAt: booking.createdAt,
      changedBy: booking.client?._id || booking.client || null,
      actorRole: "client",
    });
  }

  if (previousStatus && previousStatus !== "pending") {
    booking.statusHistory.push({
      status: previousStatus,
      changedAt: booking.updatedAt || booking.createdAt || new Date(),
      changedBy: null,
      actorRole: "system",
    });
  }
}

async function populateBooking(bookingId) {
  return Booking.findById(bookingId)
    .populate("client", "name email phone profileImage")
    .populate({
      path: "artisan",
      populate: {
        path: "user",
        select: "name email phone profileImage",
      },
    })
    .populate("statusHistory.changedBy", "name role");
}

// CREATE BOOKING
exports.createBooking = async (req, res) => {
  try {
    const { artisan, service, date, time, address, notes, price } = req.body;

    if (!artisan) {
      return res.status(400).json({
        message: "Artisan is required.",
      });
    }

    if (!mongoose.isValidObjectId(artisan)) {
      return res.status(400).json({
        message: "Invalid artisan ID.",
      });
    }

    if (!service?.trim()) {
      return res.status(400).json({
        message: "Service is required.",
      });
    }

    if (!date) {
      return res.status(400).json({
        message: "Booking date is required.",
      });
    }

    const bookingDate = new Date(date);

    if (Number.isNaN(bookingDate.getTime())) {
      return res.status(400).json({
        message: "Booking date is invalid.",
      });
    }

    if (!time?.trim()) {
      return res.status(400).json({
        message: "Booking time is required.",
      });
    }

    if (!address?.trim()) {
      return res.status(400).json({
        message: "Service address is required.",
      });
    }

    const artisanProfile = await ArtisanProfile.findById(artisan).populate(
      "user",
      "name email isSuspended",
    );

    if (!artisanProfile || !artisanProfile.user) {
      return res.status(404).json({
        message: "Artisan not found.",
      });
    }

    if (String(artisanProfile.user._id) === String(req.user._id)) {
      return res.status(400).json({
        message: "You cannot book your own artisan profile.",
      });
    }

    if (artisanProfile.user.isSuspended) {
      return res.status(403).json({
        message: "This artisan is currently unavailable.",
      });
    }

    const subscription = await getSubscriptionForUser(artisanProfile.user._id);
    const access = getSubscriptionAccess(subscription);

    if (!access.canReceiveBookings) {
      return res.status(403).json({
        success: false,
        code: "ARTISAN_SUBSCRIPTION_INACTIVE",
        message:
          "This professional is currently unavailable and cannot receive new bookings.",
        subscription: serializeSubscription(subscription),
        access,
      });
    }

    if (artisanProfile.available === false) {
      return res.status(403).json({
        message: "This artisan is not accepting bookings at the moment.",
      });
    }

    const createdAt = new Date();

    const booking = await Booking.create({
      client: req.user._id,
      artisan: artisanProfile._id,
      service: service.trim(),
      date: bookingDate,
      time: time.trim(),
      address: address.trim(),
      notes: notes?.trim() || "",
      price: Number(price) || 0,
      statusHistory: [
        {
          status: "pending",
          changedAt: createdAt,
          changedBy: req.user._id,
          actorRole: "client",
        },
      ],
    });

    const populatedBooking = await populateBooking(booking._id);

    try {
      await notifyBookingEvent({
        eventName: "created",
        booking: populatedBooking,
        actor: req.user,
      });
    } catch (communicationError) {
      console.error("Create booking communication error:", communicationError);
    }

    return res.status(201).json(populatedBooking);
  } catch (error) {
    console.error("Create booking error:", error);

    return res.status(500).json({
      message: error.message || "Unable to create booking.",
    });
  }
};

// GET MY BOOKINGS (client view)
exports.getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({
      client: req.user._id,
    })
      .populate({
        path: "artisan",
        populate: {
          path: "user",
          select: "name email phone profileImage",
        },
      })
      .populate("statusHistory.changedBy", "name role")
      .sort({ createdAt: -1 });

    return res.json(bookings);
  } catch (error) {
    console.error("Get client bookings error:", error);

    return res.status(500).json({
      message: error.message || "Unable to retrieve bookings.",
    });
  }
};

// GET ARTISAN BOOKINGS
exports.getArtisanBookings = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({
      user: req.user._id,
    });

    if (!profile) {
      return res.status(404).json({
        message: "Artisan profile not found.",
      });
    }

    const bookings = await Booking.find({
      artisan: profile._id,
    })
      .populate("client", "name email phone profileImage")
      .populate("statusHistory.changedBy", "name role")
      .sort({ createdAt: -1 });

    return res.json(bookings);
  } catch (error) {
    console.error("Get artisan bookings error:", error);

    return res.status(500).json({
      message: error.message || "Unable to retrieve artisan bookings.",
    });
  }
};

// UPDATE BOOKING STATUS
exports.updateBookingStatus = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const requestedStatus = normalizeBookingStatus(req.body.status);

    if (!mongoose.isValidObjectId(bookingId)) {
      return res.status(400).json({
        message: "Invalid booking ID.",
      });
    }

    if (!requestedStatus) {
      return res.status(400).json({
        message: "Booking status is required.",
      });
    }

    const booking = await Booking.findById(bookingId)
      .populate("client", "name email phone profileImage")
      .populate({
        path: "artisan",
        populate: {
          path: "user",
          select: "name email phone profileImage isSuspended",
        },
      });

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found.",
      });
    }

    const actorRole = req.user.role;

    if (!["client", "artisan"].includes(actorRole)) {
      return res.status(403).json({
        message: "Only the booking client or artisan can update this booking.",
      });
    }

    const artisanUserId = booking.artisan?.user?._id;
    const isBookingClient = String(booking.client?._id) === String(req.user._id);
    const isBookingArtisan =
      artisanUserId && String(artisanUserId) === String(req.user._id);

    if (actorRole === "client" && !isBookingClient) {
      return res.status(403).json({
        message: "You cannot update this booking.",
      });
    }

    if (actorRole === "artisan" && !isBookingArtisan) {
      return res.status(403).json({
        message: "You cannot update this booking.",
      });
    }

    if (actorRole === "artisan") {
      if (booking.artisan?.user?.isSuspended) {
        return res.status(403).json({
          message: "Your artisan account is currently suspended.",
        });
      }

      const subscription = await getSubscriptionForUser(req.user._id);
      const access = getSubscriptionAccess(subscription);

      if (!access.canManageBookings) {
        return res.status(403).json({
          success: false,
          code: "SUBSCRIPTION_REQUIRED",
          message:
            access.restrictionMessage ||
            "Your subscription is inactive. Renew to manage bookings.",
          subscription: serializeSubscription(subscription),
          access,
        });
      }
    }

    const previousStatus = normalizeBookingStatus(booking.status);

    if (previousStatus === requestedStatus) {
      const currentBooking = await populateBooking(booking._id);
      return res.status(200).json(currentBooking);
    }

    const transitionMap =
      actorRole === "artisan"
        ? ARTISAN_STATUS_TRANSITIONS
        : CLIENT_STATUS_TRANSITIONS;

    const allowedNextStatuses = transitionMap[booking.status] || transitionMap[previousStatus] || [];

    if (!allowedNextStatuses.includes(requestedStatus)) {
      return res.status(400).json({
        code: "INVALID_BOOKING_TRANSITION",
        message: `You cannot change a ${previousStatus.replaceAll("_", " ")} booking to ${requestedStatus.replaceAll("_", " ")}.`,
        currentStatus: previousStatus,
        requestedStatus,
        allowedStatuses: allowedNextStatuses,
      });
    }

    ensureLegacyStatusHistory(booking, previousStatus);

    booking.status = requestedStatus;

    const changedAt = applyLifecycleTimestamp(
      booking,
      requestedStatus,
      actorRole,
    );

    appendStatusHistory(booking, {
      status: requestedStatus,
      actorId: req.user._id,
      actorRole,
      changedAt,
    });

    await booking.save();

    const updatedBooking = await populateBooking(booking._id);

    const communicationEvent = {
      accepted: "accepted",
      declined: "declined",
      in_progress: "started",
      awaiting_confirmation: "completion_requested",
      cancelled: "cancelled",
      completed: "completed",
    }[requestedStatus];

    if (communicationEvent) {
      try {
        await notifyBookingEvent({
          eventName: communicationEvent,
          booking: updatedBooking,
          actor: req.user,
        });
      } catch (communicationError) {
        console.error("Booking status communication error:", communicationError);
      }
    }

    return res.status(200).json(updatedBooking);
  } catch (error) {
    console.error("Update booking status error:", error);

    return res.status(500).json({
      message: error.message || "Unable to update booking status.",
    });
  }
};

// SEND BOOKING MESSAGE TO ARTISAN
exports.sendBookingMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = req.body.message?.trim();

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required.",
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Message must not exceed 1,000 characters.",
      });
    }

    const booking = await Booking.findOne({
      _id: id,
      client: req.user._id,
    }).populate({
      path: "artisan",
      populate: {
        path: "user",
        select: "name email isSuspended",
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    const artisanUser = booking.artisan?.user;

    if (!artisanUser) {
      return res.status(404).json({
        success: false,
        message: "Professional account not found.",
      });
    }

    if (artisanUser.isSuspended) {
      return res.status(403).json({
        success: false,
        message: "This professional is currently unavailable.",
      });
    }

    const client = await User.findById(req.user._id).select(
      "name profileImage",
    );

    const notification = await createNotification({
      recipient: artisanUser._id,
      actor: req.user._id,
      type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
      category: NOTIFICATION_CATEGORIES.MESSAGE,
      title: `Message from ${client?.name || "a client"}`,
      message,
      actionUrl: `/artisan/dashboard?tab=bookings&booking=${booking._id}`,
      resourceType: "booking",
      resourceId: booking._id,
      metadata: {
        bookingId: booking._id,
        service: booking.service,
        clientName: client?.name || "",
        message,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Your message has been sent.",
      notification,
    });
  } catch (error) {
    console.error("Send booking message error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send your message. Please try again.",
    });
  }
};
