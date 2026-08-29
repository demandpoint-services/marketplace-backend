const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  return secretKey;
}

async function parsePaystackResponse(response) {
  const responseText = await response.text();

  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    const error = new Error(
      `Paystack returned an invalid response with status ${response.status}.`,
    );

    error.status = response.status;
    throw error;
  }

  if (!response.ok || result?.status !== true) {
    const error = new Error(result?.message || "Paystack request failed.");

    error.status = response.status;
    error.paystackResponse = result;

    throw error;
  }

  return result;
}

async function initializeTransaction({
  email,
  amountKobo,
  reference,
  planCode,
  callbackUrl,
  metadata,
  channels,
}) {
  const payload = {
    email,
    amount: String(amountKobo),
    currency: "NGN",
    reference,
    callback_url: callbackUrl,
    metadata,
  };

  /*
   * Subscription checkout supplies a Paystack plan.
   * Marketplace orders do not.
   */
  if (planCode) {
    payload.plan = planCode;
  }

  /*
   * Subscription checkout currently requires card because we need
   * a reusable authorization for recurring billing.
   *
   * Marketplace checkout can use the payment channels enabled on
   * the Paystack account unless explicitly restricted.
   */
  if (Array.isArray(channels) && channels.length > 0) {
    payload.channels = channels;
  } else if (planCode) {
    payload.channels = ["card"];
  }

  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },

    body: JSON.stringify(payload),
  });

  return parsePaystackResponse(response);
}

async function verifyTransaction(reference) {
  if (!reference) {
    throw new Error("Paystack transaction reference is required.");
  }

  const encodedReference = encodeURIComponent(reference);

  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodedReference}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
    },
  );

  return parsePaystackResponse(response);
}

async function fetchPlan(planCode) {
  if (!planCode) {
    throw new Error("Paystack plan code is required.");
  }

  const encodedPlanCode = encodeURIComponent(planCode);

  const response = await fetch(`${PAYSTACK_BASE_URL}/plan/${encodedPlanCode}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
  });

  return parsePaystackResponse(response);
}

async function disableSubscription({ code, token }) {
  if (!code || !token) {
    const error = new Error(
      "Paystack subscription code and email token are required.",
    );

    error.status = 409;
    error.code = "PAYSTACK_SUBSCRIPTION_DETAILS_MISSING";

    throw error;
  }

  const response = await fetch(`${PAYSTACK_BASE_URL}/subscription/disable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      token,
    }),
  });

  return parsePaystackResponse(response);
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  fetchPlan,
  disableSubscription,
};
