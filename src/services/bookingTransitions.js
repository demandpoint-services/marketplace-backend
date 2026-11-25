const transitions = {
  client: { pending: ["cancelled"], accepted: ["cancelled"], awaiting_confirmation: ["completed"] },
  artisan: { pending: ["accepted", "declined"], accepted: ["in_progress"], in_progress: ["awaiting_confirmation"] },
};
function normalizeBookingStatus(status) {
  return String(status || "").trim().toLowerCase().replace(/^in-progress$/, "in_progress");
}
module.exports = { transitions, normalizeBookingStatus };
