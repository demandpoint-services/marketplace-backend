const User = require("../models/User");
const ArtisanProfile = require("../models/ArtisanProfile");
const resend = require("../config/resend");

const {
  createNotificationSafely,
  getOrCreatePreferences,
} = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");
const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

const EVENT_CONFIG = {
  created: {
    type: NOTIFICATION_TYPES.BOOKING_CREATED,
    preferenceField: "bookingCreated",
    recipient: "artisan",
    title: "New booking request",
    subject: "You have a new booking request",
  },
  accepted: {
    type: NOTIFICATION_TYPES.BOOKING_ACCEPTED,
    preferenceField: "bookingAccepted",
    recipient: "client",
    title: "Booking accepted",
    subject: "Your booking was accepted",
  },
  declined: {
    type: NOTIFICATION_TYPES.BOOKING_DECLINED,
    preferenceField: "bookingDeclined",
    recipient: "client",
    title: "Booking declined",
    subject: "Your booking was declined",
  },
  started: {
    type: NOTIFICATION_TYPES.BOOKING_STARTED,
    preferenceField: "bookingStarted",
    recipient: "client",
    title: "Work has started",
    subject: "Your booking is now in progress",
  },
  completion_requested: {
    type: NOTIFICATION_TYPES.BOOKING_COMPLETION_REQUESTED,
    preferenceField: "bookingCompletionRequested",
    recipient: "client",
    title: "Confirm job completion",
    subject: "Please confirm your booking is complete",
  },
  cancelled: {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    preferenceField: "bookingCancelled",
    recipient: "artisan",
    title: "Booking cancelled",
    subject: "A booking was cancelled",
  },
  completed: {
    type: NOTIFICATION_TYPES.BOOKING_COMPLETED,
    preferenceField: "bookingCompleted",
    recipient: "artisan",
    title: "Booking completed",
    subject: "A client confirmed job completion",
  },
};

function formatBookingDate(booking) {
  if (!booking?.date) return "the scheduled date";

  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(booking.date));
}

function buildMessage(eventName, booking, actorName) {
  const service = booking.service || "service";

  switch (eventName) {
    case "created":
      return `${actorName || "A client"} requested your ${service} service for ${formatBookingDate(booking)}.`;
    case "accepted":
      return `Your ${service} booking has been accepted by the professional.`;
    case "declined":
      return `Your ${service} booking was declined. You can choose another professional from the marketplace.`;
    case "started":
      return `Work on your ${service} booking has started.`;
    case "completion_requested":
      return `The professional marked your ${service} job as finished. Please confirm completion from your bookings page.`;
    case "cancelled":
      return `${actorName || "The client"} cancelled the ${service} booking.`;
    case "completed":
      return `${actorName || "The client"} confirmed that the ${service} booking has been completed.`;
    default:
      return `There is an update to your ${service} booking.`;
  }
}

async function resolveUsers(booking) {
  const client =
    booking.client && typeof booking.client === "object" && booking.client.email
      ? booking.client
      : await User.findById(booking.client).select("name email");

  let artisanProfile = booking.artisan;

  if (!artisanProfile || typeof artisanProfile !== "object" || !artisanProfile.user) {
    artisanProfile = await ArtisanProfile.findById(booking.artisan).populate(
      "user",
      "name email",
    );
  } else if (typeof artisanProfile.user !== "object" || !artisanProfile.user.email) {
    artisanProfile = await ArtisanProfile.findById(artisanProfile._id).populate(
      "user",
      "name email",
    );
  }

  return {
    client,
    artisan: artisanProfile?.user || null,
  };
}

async function sendBookingEmail({ recipient, eventConfig, booking, message }) {
  if (!recipient?.email || !process.env.RESEND_API_KEY) {
    return null;
  }

  const preferences = await getOrCreatePreferences(recipient._id);

  if (
    preferences.emailNotifications === false ||
    (eventConfig.preferenceField &&
      preferences[eventConfig.preferenceField] === false)
  ) {
    return null;
  }

  return resend.emails.send({
    from: "Demand Point Skills and Services <noreply@mail.demandpoint.app>",
    to: recipient.email,
    subject: `${eventConfig.subject} | Demand Point`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:36px;color:#171717;">
        <div style="font-size:24px;font-weight:700;color:#7C3BFF;margin-bottom:24px;">Demand Point</div>
        <h2 style="margin:0 0 14px;font-size:24px;">${eventConfig.title}</h2>
        <p style="font-size:16px;line-height:1.7;color:#555;">${message}</p>
        <div style="margin:26px 0;padding:18px;border-radius:12px;background:#f7f5ff;">
          <p style="margin:0 0 8px;"><strong>Service:</strong> ${booking.service || "Service request"}</p>
          <p style="margin:0 0 8px;"><strong>Date:</strong> ${formatBookingDate(booking)}</p>
          <p style="margin:0;"><strong>Status:</strong> ${String(booking.status || "pending").replaceAll("_", " ")}</p>
        </div>
        <a href="${process.env.FRONTEND_URL || "https://demandpoint.app"}/bookings"
          style="display:inline-block;background:#7C3BFF;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700;">
          View booking
        </a>
        <p style="margin-top:34px;font-size:12px;color:#999;">© ${new Date().getFullYear()} Demand Point Skills and Services.</p>
      </div>
    `,
  });
}

async function notifyBookingEvent({ eventName, booking, actor = null }) {
  const eventConfig = EVENT_CONFIG[eventName];

  if (!eventConfig) {
    throw new Error(`Unsupported booking communication event: ${eventName}`);
  }

  const users = await resolveUsers(booking);
  const recipient = users[eventConfig.recipient];

  if (!recipient) {
    return null;
  }

  const actorName = actor?.name || null;
  const message = buildMessage(eventName, booking, actorName);
  const actionUrl =
    eventConfig.recipient === "artisan"
      ? `/artisan/dashboard?tab=bookings&booking=${booking._id}`
      : "/bookings";

  const notification = await createNotificationSafely(
    {
      recipient: recipient._id,
      actor: actor?._id || null,
      type: eventConfig.type,
      category: NOTIFICATION_CATEGORIES.BOOKING,
      title: eventConfig.title,
      message,
      actionUrl,
      resourceType: "booking",
      resourceId: booking._id,
      dedupeKey: `booking:${booking._id}:${eventName}`,
      metadata: {
        bookingId: booking._id,
        service: booking.service,
        status: booking.status,
      },
    },
    `Booking ${eventName} notification`,
  );

  try {
    await sendBookingEmail({
      recipient,
      eventConfig,
      booking,
      message,
    });
  } catch (error) {
    console.error(`Booking ${eventName} email error:`, error);
  }

  return notification;
}

module.exports = {
  notifyBookingEvent,
};
