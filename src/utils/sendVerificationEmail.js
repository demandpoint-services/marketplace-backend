const resend = require("../config/resend");

async function sendVerificationEmail(email, code) {
  try {
    const response = await resend.emails.send({
      from: "Demand Point <onboarding@resend.dev>",
      to: email,
      subject: "Verify your Demand Point account",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:40px;">
          <h2 style="color:#7C3BFF;">Verify your email</h2>

          <p>Thanks for creating your Demand Point account.</p>

          <p>Enter the verification code below:</p>

          <div style="
            font-size:34px;
            font-weight:bold;
            letter-spacing:10px;
            text-align:center;
            background:#f5f5f5;
            padding:20px;
            margin:30px 0;
            border-radius:10px;
          ">
            ${code}
          </div>

          <p>This code expires in <strong>10 minutes</strong>.</p>

          <p>If you didn't create this account, you can safely ignore this email.</p>

          <hr>

          <small style="color:#777;">
            © Demand Point Marketplace
          </small>
        </div>
      `,
    });
    console.log("Resend response:", response);
  } catch (err) {
    console.error("Verification email failed:", err);
    throw err;
  }
}

module.exports = sendVerificationEmail;
