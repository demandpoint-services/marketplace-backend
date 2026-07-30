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
    throw new Error(
      `Paystack returned an invalid response with status ${response.status}.`,
    );
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
}) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: String(amountKobo),
      currency: "NGN",
      reference,
      plan: planCode,
      callback_url: callbackUrl,

      // Card payments provide a reusable authorization
      // needed for automatic subscription renewals.
      channels: ["card"],

      metadata,
    }),
  });

  return parsePaystackResponse(response);
}

async function verifyTransaction(reference) {
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

module.exports = {
  initializeTransaction,
  verifyTransaction,
  fetchPlan,
};
