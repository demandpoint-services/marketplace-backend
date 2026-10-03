const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SpaceBooking = require("../models/SpaceBooking");

function parseTimeToMinutes(value) {
  const match = TIME_PATTERN.exec(String(value || "").trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function parseDateParts(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || "").trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
  };
}

/**
 * Demand Point currently operates spaces using Africa/Lagos.
 *
 * Nigeria is UTC+1 throughout the year, so we convert the
 * local requested date/time to UTC explicitly.
 *
 * If Demand Point later supports spaces in multiple timezone
 * regions, replace this with a timezone-aware library/API.
 */
function lagosLocalToUtc(dateString, timeString) {
  const date = parseDateParts(dateString);
  const minutes = parseTimeToMinutes(timeString);

  if (!date || minutes === null) {
    return null;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return new Date(Date.UTC(date.year, date.month - 1, date.day, hours - 1, mins, 0, 0));
}

function getDayOfWeek(dateString) {
  const date = parseDateParts(dateString);

  if (!date) {
    return null;
  }

  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function validateWeeklySchedule(weeklySchedule) {
  if (!Array.isArray(weeklySchedule)) {
    throw new Error("Weekly schedule must be an array.");
  }

  const seenDays = new Set();

  const normalized = weeklySchedule.map((day) => {
    const dayOfWeek = Number(day?.dayOfWeek);

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new Error("Each availability day must use dayOfWeek from 0 to 6.");
    }

    if (seenDays.has(dayOfWeek)) {
      throw new Error(`Duplicate availability configuration for day ${dayOfWeek}.`);
    }

    seenDays.add(dayOfWeek);

    const enabled = day?.enabled === true;

    const windows = Array.isArray(day?.windows) ? day.windows : [];

    if (!enabled) {
      return {
        dayOfWeek,
        enabled: false,
        windows: [],
      };
    }

    if (windows.length === 0) {
      throw new Error(`Enabled day ${dayOfWeek} requires at least one availability window.`);
    }

    const normalizedWindows = windows
      .map((window) => {
        const startTime = String(window?.startTime || "").trim();

        const endTime = String(window?.endTime || "").trim();

        const startMinutes = parseTimeToMinutes(startTime);

        const endMinutes = parseTimeToMinutes(endTime);

        if (startMinutes === null || endMinutes === null) {
          throw new Error("Availability times must use HH:MM format.");
        }

        if (endMinutes <= startMinutes) {
          throw new Error("Availability end time must be later than start time.");
        }

        return {
          startTime,
          endTime,
          startMinutes,
          endMinutes,
        };
      })
      .sort((a, b) => a.startMinutes - b.startMinutes);

    for (let index = 1; index < normalizedWindows.length; index += 1) {
      const previous = normalizedWindows[index - 1];

      const current = normalizedWindows[index];

      if (current.startMinutes < previous.endMinutes) {
        throw new Error("Availability windows cannot overlap.");
      }
    }

    return {
      dayOfWeek,
      enabled: true,

      windows: normalizedWindows.map(({ startTime, endTime }) => ({
        startTime,
        endTime,
      })),
    };
  });

  // Always return all seven days.
  for (let day = 0; day <= 6; day += 1) {
    if (!seenDays.has(day)) {
      normalized.push({
        dayOfWeek: day,
        enabled: false,
        windows: [],
      });
    }
  }

  return normalized.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function calculateSpacePrice({ pricing, durationMinutes }) {
  if (!pricing || !Number.isFinite(Number(pricing.amountKobo))) {
    throw new Error("Space pricing is not configured.");
  }

  const amountKobo = Number(pricing.amountKobo);

  const pricingType = pricing.type || "hourly";

  let subtotalKobo;

  if (pricingType === "hourly") {
    subtotalKobo = Math.ceil((durationMinutes / 60) * amountKobo);
  } else if (pricingType === "daily") {
    // Phase 2 requests are currently restricted
    // to one calendar day.
    subtotalKobo = amountKobo;
  } else {
    // fixed
    subtotalKobo = amountKobo;
  }

  return {
    pricingType,
    baseAmountKobo: amountKobo,
    durationMinutes,
    subtotalKobo,
    totalKobo: subtotalKobo,
    currency: "NGN",
  };
}

async function checkBookingConflicts({ spaceId, startAt, endAt, excludeBookingId = null }) {
  const now = new Date();

  const query = {
    space: spaceId,

    startAt: {
      $lt: endAt,
    },

    endAt: {
      $gt: startAt,
    },

    $or: [
      // A confirmed reservation always blocks the period.
      {
        status: "confirmed",
      },

      // A pending payment only blocks the period while
      // its temporary hold is still alive.
      {
        status: "pending_payment",

        holdExpiresAt: {
          $gt: now,
        },
      },
    ],
  };

  if (excludeBookingId) {
    query._id = {
      $ne: excludeBookingId,
    };
  }

  return SpaceBooking.findOne(query).select("_id status startAt endAt holdExpiresAt").lean();
}

async function checkSpaceAvailability({ space, date, startTime, endTime }) {
  if (!space) {
    return {
      available: false,
      reason: "SPACE_NOT_FOUND",
      message: "Space not found.",
    };
  }

  if (space.status !== "active") {
    return {
      available: false,
      reason: "SPACE_NOT_ACTIVE",
      message: "This space is not currently available for booking.",
    };
  }

  const dateParts = parseDateParts(date);

  const startMinutes = parseTimeToMinutes(startTime);

  const endMinutes = parseTimeToMinutes(endTime);

  if (!dateParts || startMinutes === null || endMinutes === null) {
    return {
      available: false,
      reason: "INVALID_DATE_TIME",
      message: "Enter a valid date, start time and end time.",
    };
  }

  if (endMinutes <= startMinutes) {
    return {
      available: false,
      reason: "INVALID_TIME_RANGE",
      message: "End time must be later than start time.",
    };
  }

  const startAt = lagosLocalToUtc(date, startTime);

  const endAt = lagosLocalToUtc(date, endTime);

  if (!startAt || !endAt) {
    return {
      available: false,
      reason: "INVALID_DATE_TIME",
      message: "Enter a valid booking date and time.",
    };
  }

  if (startAt <= new Date()) {
    return {
      available: false,
      reason: "PAST_TIME",
      message: "Bookings must start in the future.",
    };
  }

  const durationMinutes = endMinutes - startMinutes;

  const minimumHours = Number(space.pricing?.minimumHours || 1);

  const minimumMinutes = minimumHours * 60;

  if (durationMinutes < minimumMinutes) {
    return {
      available: false,
      reason: "MINIMUM_DURATION",
      message: `This space requires a minimum booking of ${minimumHours} hour${
        minimumHours === 1 ? "" : "s"
      }.`,
    };
  }

  const dayOfWeek = getDayOfWeek(date);

  const daySchedule = space.availability?.weeklySchedule?.find(
    (day) => Number(day.dayOfWeek) === dayOfWeek
  );

  if (!daySchedule || !daySchedule.enabled) {
    return {
      available: false,
      reason: "CLOSED",
      message: "This space is closed on the selected day.",
    };
  }

  const matchingWindow = daySchedule.windows?.find((window) => {
    const windowStart = parseTimeToMinutes(window.startTime);

    const windowEnd = parseTimeToMinutes(window.endTime);

    return (
      windowStart !== null &&
      windowEnd !== null &&
      startMinutes >= windowStart &&
      endMinutes <= windowEnd
    );
  });

  if (!matchingWindow) {
    return {
      available: false,
      reason: "OUTSIDE_OPERATING_HOURS",
      message: "The selected time is outside this space's available hours.",
    };
  }

  const blockedPeriod = space.blockedPeriods?.find((period) => {
    const blockedStart = new Date(period.startAt);

    const blockedEnd = new Date(period.endAt);

    return rangesOverlap(startAt, endAt, blockedStart, blockedEnd);
  });

  if (blockedPeriod) {
    return {
      available: false,
      reason: "BLOCKED",
      message: "This space is unavailable during the selected time.",
    };
  }

  const bookingConflict = await checkBookingConflicts({
    spaceId: space._id,
    startAt,
    endAt,
  });

  if (bookingConflict) {
    return {
      available: false,
      reason: "ALREADY_BOOKED",
      message: "This space has already been reserved for the selected time.",
    };
  }

  const quote = calculateSpacePrice({
    pricing: space.pricing,
    durationMinutes,
  });

  return {
    available: true,

    reason: null,

    message: "Space is available.",

    selection: {
      date,
      startTime,
      endTime,
      startAt,
      endAt,
      durationMinutes,
    },

    quote,
  };
}

module.exports = {
  parseTimeToMinutes,
  minutesToTime,
  validateWeeklySchedule,
  calculateSpacePrice,
  checkBookingConflicts,
  checkSpaceAvailability,
};
