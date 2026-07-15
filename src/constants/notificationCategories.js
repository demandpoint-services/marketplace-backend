const NOTIFICATION_CATEGORIES = Object.freeze({
  BOOKING: "booking",
  MESSAGE: "message",
  PAYMENT: "payment",
  SECURITY: "security",
  REVIEW: "review",
  SYSTEM: "system",
  PROMOTION: "promotion",
});

const NOTIFICATION_CATEGORY_VALUES = Object.freeze(
  Object.values(NOTIFICATION_CATEGORIES),
);

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_VALUES,
};
