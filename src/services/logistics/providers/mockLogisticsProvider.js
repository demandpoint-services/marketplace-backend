const PROVIDER_NAME = "mock";

/**
 * Temporary logistics provider used while the real
 * ABC Cargo API integration is unavailable.
 *
 * IMPORTANT:
 * The prices returned by this provider are development/test
 * estimates only. They must not be treated as real courier rates.
 */

const SAME_STATE_BASE_FEE_KOBO = 250000; // ₦2,500
const DIFFERENT_STATE_BASE_FEE_KOBO = 450000; // ₦4,500

const ADDITIONAL_KG_FEE_KOBO = 50000; // ₦500 per additional kg

/**
 * Temporary volumetric divisor.
 *
 * This is deliberately isolated in the mock provider.
 * ABC Cargo's actual divisor/rules should replace this
 * when their API documentation is available.
 */
const MOCK_VOLUMETRIC_DIVISOR = 5000;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLocation(location = {}) {
  return {
    address: normalizeText(location.address),
    city: normalizeText(location.city),
    state: normalizeText(location.state),
    country: normalizeText(location.country || "Nigeria"),
  };
}

function roundUpWeight(weight) {
  if (!Number.isFinite(weight) || weight <= 0) {
    return 0;
  }

  return Math.ceil(weight);
}

function calculateVolumetricWeight({
  lengthCm = 0,
  widthCm = 0,
  heightCm = 0,
}) {
  const length = Number(lengthCm) || 0;
  const width = Number(widthCm) || 0;
  const height = Number(heightCm) || 0;

  if (length <= 0 || width <= 0 || height <= 0) {
    return 0;
  }

  return (length * width * height) / MOCK_VOLUMETRIC_DIVISOR;
}

function calculatePackageWeight(items = []) {
  let actualWeightKg = 0;
  let volumetricWeightKg = 0;

  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity) || 1);

    const weightKg = Math.max(0, Number(item.weightKg) || 0);

    const dimensions = item.dimensions || {};

    const itemVolumetricWeight = calculateVolumetricWeight({
      lengthCm: dimensions.lengthCm,
      widthCm: dimensions.widthCm,
      heightCm: dimensions.heightCm,
    });

    actualWeightKg += weightKg * quantity;

    volumetricWeightKg += itemVolumetricWeight * quantity;
  }

  const chargeableWeightKg = Math.max(actualWeightKg, volumetricWeightKg);

  return {
    actualWeightKg: Number(actualWeightKg.toFixed(2)),

    volumetricWeightKg: Number(volumetricWeightKg.toFixed(2)),

    chargeableWeightKg: Number(chargeableWeightKg.toFixed(2)),
  };
}

function calculateMockFee({ origin, destination, chargeableWeightKg }) {
  const originState = normalizeText(origin.state).toLowerCase();

  const destinationState = normalizeText(destination.state).toLowerCase();

  const sameState =
    originState && destinationState && originState === destinationState;

  const baseFeeKobo = sameState
    ? SAME_STATE_BASE_FEE_KOBO
    : DIFFERENT_STATE_BASE_FEE_KOBO;

  const roundedWeight = Math.max(1, roundUpWeight(chargeableWeightKg));

  const additionalWeightKg = Math.max(0, roundedWeight - 1);

  const additionalWeightFeeKobo = additionalWeightKg * ADDITIONAL_KG_FEE_KOBO;

  return {
    baseFeeKobo,
    additionalWeightFeeKobo,
    shippingFeeKobo: baseFeeKobo + additionalWeightFeeKobo,
  };
}

/**
 * Calculates one shipment quote.
 *
 * One shipment represents:
 *
 * ONE vendor pickup location
 *        ↓
 * ONE customer destination
 *
 * Multiple products belonging to the same vendor can therefore
 * be combined into this shipment.
 */
async function calculateShippingQuote({ origin, destination, items = [] }) {
  const normalizedOrigin = normalizeLocation(origin);

  const normalizedDestination = normalizeLocation(destination);

  if (!normalizedOrigin.state) {
    throw new Error("A vendor pickup state is required to calculate shipping.");
  }

  if (!normalizedDestination.state) {
    throw new Error("A delivery state is required to calculate shipping.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one product is required to calculate shipping.");
  }

  const weights = calculatePackageWeight(items);

  const fees = calculateMockFee({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    chargeableWeightKg: weights.chargeableWeightKg,
  });

  return {
    provider: PROVIDER_NAME,

    serviceType: "standard",

    currency: "NGN",

    origin: normalizedOrigin,

    destination: normalizedDestination,

    actualWeightKg: weights.actualWeightKg,

    volumetricWeightKg: weights.volumetricWeightKg,

    chargeableWeightKg: weights.chargeableWeightKg,

    baseFeeKobo: fees.baseFeeKobo,

    additionalWeightFeeKobo: fees.additionalWeightFeeKobo,

    shippingFeeKobo: fees.shippingFeeKobo,

    estimatedDeliveryDays:
      normalizedOrigin.state.toLowerCase() ===
      normalizedDestination.state.toLowerCase()
        ? 1
        : 3,

    quoteReference: `MOCK-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`,

    isMock: true,
  };
}

module.exports = {
  calculateShippingQuote,
};
