const mockLogisticsProvider = require("./providers/mockLogisticsProvider");

const PROVIDERS = {
  mock: mockLogisticsProvider,
};

function getConfiguredProviderName() {
  return String(process.env.LOGISTICS_PROVIDER || "mock")
    .trim()
    .toLowerCase();
}

function getProvider(providerName) {
  const normalizedProvider = String(providerName || getConfiguredProviderName())
    .trim()
    .toLowerCase();

  const provider = PROVIDERS[normalizedProvider];

  if (!provider) {
    const error = new Error(
      `Unsupported logistics provider: ${normalizedProvider}`,
    );

    error.status = 500;

    throw error;
  }

  return {
    name: normalizedProvider,
    provider,
  };
}

function validateLocation(location, label) {
  if (!location || typeof location !== "object") {
    const error = new Error(`${label} location is required.`);

    error.status = 400;

    throw error;
  }

  if (!String(location.state || "").trim()) {
    const error = new Error(`${label} state is required.`);

    error.status = 400;

    throw error;
  }
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("At least one shipment item is required.");

    error.status = 400;

    throw error;
  }

  for (const item of items) {
    const quantity = Number(item.quantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
      const error = new Error("Shipment item quantity must be at least 1.");

      error.status = 400;

      throw error;
    }

    const weightKg = Number(item.weightKg || 0);

    if (!Number.isFinite(weightKg) || weightKg < 0) {
      const error = new Error("Shipment item weight must be a valid number.");

      error.status = 400;

      throw error;
    }
  }
}

/**
 * Provider-agnostic shipping quote.
 *
 * Controllers and checkout should call this function instead of
 * calling ABC Cargo, the mock provider, or another courier directly.
 */
async function calculateShipping({ origin, destination, items, providerName }) {
  validateLocation(origin, "Pickup");

  validateLocation(destination, "Delivery");

  validateItems(items);

  const { name, provider } = getProvider(providerName);

  const quote = await provider.calculateShippingQuote({
    origin,
    destination,
    items,
  });

  if (!quote) {
    const error = new Error(`${name} did not return a shipping quote.`);

    error.status = 502;

    throw error;
  }

  const shippingFeeKobo = Number(quote.shippingFeeKobo);

  if (!Number.isFinite(shippingFeeKobo) || shippingFeeKobo < 0) {
    const error = new Error(`${name} returned an invalid shipping fee.`);

    error.status = 502;

    throw error;
  }

  return {
    ...quote,

    provider: quote.provider || name,

    shippingFeeKobo,
  };
}

module.exports = {
  calculateShipping,
};
