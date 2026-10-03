const crypto = require("crypto");

function verifyPaystackWebhook(req, res, next) {
  try {
    const signature = req.headers["x-paystack-signature"];

    if (!signature) {
      return res.status(401).json({
        success: false,
        message: "Missing Paystack signature.",
      });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error("PAYSTACK_SECRET_KEY is missing while processing webhook.");

      return res.sendStatus(500);
    }

    /*
     * Paystack signs the JSON payload using HMAC SHA-512.
     */
    if (!req.rawBody) {
      console.error("Paystack webhook raw body is missing.");
      return res.sendStatus(500);
    }

    const hash = crypto.createHmac("sha512", secretKey).update(req.rawBody).digest("hex");

    const signatureBuffer = Buffer.from(signature, "hex");
    const hashBuffer = Buffer.from(hash, "hex");

    if (
      signatureBuffer.length !== hashBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, hashBuffer)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid Paystack signature.",
      });
    }

    next();
  } catch (error) {
    console.error("Paystack webhook signature error:", error);

    return res.sendStatus(500);
  }
}

module.exports = {
  verifyPaystackWebhook,
};
