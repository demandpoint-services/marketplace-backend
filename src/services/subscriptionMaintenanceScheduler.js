const {
  processSubscriptionMaintenance,
} = require("./subscriptionMaintenanceService");

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;

let intervalHandle = null;
let running = false;

async function runMaintenanceSafely(source = "scheduler") {
  if (running) {
    console.log(`Subscription maintenance skipped (${source}): already running.`);
    return null;
  }

  running = true;

  try {
    const result = await processSubscriptionMaintenance();
    console.log(`Subscription maintenance completed (${source}):`, result);
    return result;
  } catch (error) {
    console.error(`Subscription maintenance failed (${source}):`, error);
    return null;
  } finally {
    running = false;
  }
}

function startSubscriptionMaintenanceScheduler() {
  if (process.env.SUBSCRIPTION_MAINTENANCE_ENABLED === "false") {
    console.log("Subscription maintenance scheduler is disabled.");
    return null;
  }

  if (intervalHandle) return intervalHandle;

  const intervalMs = Number(
    process.env.SUBSCRIPTION_MAINTENANCE_INTERVAL_MS || DEFAULT_INTERVAL_MS,
  );

  const initialDelayMs = Number(
    process.env.SUBSCRIPTION_MAINTENANCE_INITIAL_DELAY_MS ||
      DEFAULT_INITIAL_DELAY_MS,
  );

  setTimeout(() => {
    runMaintenanceSafely("startup");
  }, Number.isFinite(initialDelayMs) ? initialDelayMs : DEFAULT_INITIAL_DELAY_MS);

  intervalHandle = setInterval(() => {
    runMaintenanceSafely("interval");
  }, Number.isFinite(intervalMs) ? intervalMs : DEFAULT_INTERVAL_MS);

  intervalHandle.unref?.();

  console.log(
    `Subscription maintenance scheduler started with interval ${intervalMs}ms.`,
  );

  return intervalHandle;
}

module.exports = {
  runMaintenanceSafely,
  startSubscriptionMaintenanceScheduler,
};
