const Booking = require("../models/Booking");
const ArtisanProfile = require("../models/ArtisanProfile");
const mongoose = require("mongoose");
const User = require("../models/User");

const { createNotification } = require("../services/notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

const allowedStatusTransitions = {
  pending: ["accepted", "declined", "cancelled"],
  accepted: ["completed", "cancelled"],
  declined: [],
  completed: [],
  cancelled: [],
};

// CREATE BOOKING
exports.createBooking = async (req, res) => {
  try {
    const { artisan, service, date, time, address, notes, price } = req.body;

    if (!artisan) {
      return res.status(400).json({
        message: "Artisan is required.",
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

    if (!time) {
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

    if (artisanProfile.user.isSuspended) {
      return res.status(403).json({
        message: "This artisan is currently unavailable.",
      });
    }

    if (artisanProfile.available === false) {
      return res.status(403).json({
        message: "This artisan is not accepting bookings at the moment.",
      });
    }

    const booking = await Booking.create({
      client: req.user._id,
      artisan: artisanProfile._id,
      service: service.trim(),
      date,
      time,
      address: address.trim(),
      notes: notes?.trim() || "",
      price: Number(price) || 0,
    });

    try {
      await createNotification({
        recipient: artisanProfile.user._id,
        actor: req.user._id,
        type: NOTIFICATION_TYPES.BOOKING_CREATED,
        category: NOTIFICATION_CATEGORIES.BOOKING,
        title: "New booking request",
        message: `${req.user.name || "A client"} requested your ${
          booking.service
        } service.`,
        actionUrl: "/artisan/dashboard?tab=bookings",
        resourceType: "booking",
        resourceId: booking._id,
        metadata: {
          bookingId: booking._id,
          service: booking.service,
          date: booking.date,
          time: booking.time,
          clientName: req.user.name || "",
        },
      });
    } catch (notificationError) {
      console.error("Create booking notification error:", notificationError);
    }

    const populatedBooking = await Booking.findById(booking._id)
      .populate("client", "name email phone profileImage")
      .populate({
        path: "artisan",
        populate: {
          path: "user",
          select: "name email phone profileImage",
        },
      });

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
          select: "name email",
        },
      })
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({
      message: error.message,
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
        message: "Artisan profile not found",
      });
    }

    const bookings = await Booking.find({
      artisan: profile._id,
    })
      .populate("client", "name email phone")
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// UPDATE BOOKING STATUS
exports.updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        message: "Booking status is required.",
      });
    }

    const booking = await Booking.findById(req.params.id).populate({
      path: "artisan",
      populate: {
        path: "user",
        select: "name",
      },
    });

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found.",
      });
    }

    const artisanUserId = booking.artisan?.user?._id;

    if (
      req.user.role === "artisan" &&
      String(artisanUserId) !== String(req.user._id)
    ) {
      return res.status(403).json({
        message: "You cannot update this booking.",
      });
    }

    const previousStatus = booking.status;

    if (previousStatus === status) {
      return res.status(200).json(booking);
    }

    const allowedNextStatuses = allowedStatusTransitions[previousStatus] || [];

    if (!allowedNextStatuses.includes(status)) {
      return res.status(400).json({
        message: `A ${previousStatus} booking cannot be changed to ${status}.`,
      });
    }

    booking.status = status;

    await booking.save();

    const statusNotifications = {
      accepted: {
        type: NOTIFICATION_TYPES.BOOKING_ACCEPTED,
        title: "Booking accepted",
        message: `Your ${booking.service} booking has been accepted.`,
      },

      declined: {
        type: NOTIFICATION_TYPES.BOOKING_DECLINED,
        title: "Booking declined",
        message: `Your ${booking.service} booking was declined.`,
      },

      cancelled: {
        type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
        title: "Booking cancelled",
        message: `Your ${booking.service} booking has been cancelled.`,
      },

      completed: {
        type: NOTIFICATION_TYPES.BOOKING_COMPLETED,
        title: "Booking completed",
        message: `Your ${booking.service} booking has been marked as completed.`,
      },
    };

    const notificationDetails = statusNotifications[status];

    if (notificationDetails) {
      try {
        await createNotification({
          recipient: booking.client,
          actor: req.user._id,
          type: notificationDetails.type,
          category: NOTIFICATION_CATEGORIES.BOOKING,
          title: notificationDetails.title,
          message: notificationDetails.message,
          actionUrl: "/bookings",
          resourceType: "booking",
          resourceId: booking._id,
          metadata: {
            bookingId: booking._id,
            service: booking.service,
            previousStatus,
            status,
          },
        });
      } catch (notificationError) {
        console.error("Booking status notification error:", notificationError);
      }
    }

    return res.status(200).json(booking);
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
