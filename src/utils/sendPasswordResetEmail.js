const resend = require("../config/resend");

async function sendPasswordResetEmail(email, code) {
  try {
    const response = await resend.emails.send({
      from: "Demand Point Skills and Services <noreply@mail.demandpoint.app>",
      to: email,
      subject: "Reset your Demand Point password",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:40px;">
          <h2 style="color:#7C3BFF;">Reset your password</h2>

          <p>We received a request to reset your Demand Point password.</p>

          <p>Enter the password reset code below:</p>

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

          <p>
            If you didn't request a password reset, you can safely ignore this email.
            Your password will remain unchanged.
          </p>

          <hr style="margin:40px 0;border:none;border-top:1px solid #eee;">

          <p style="font-size:14px;color:#777;text-align:center;">
            Demand Point Skills and Services
          </p>

          <p style="font-size:12px;color:#999;text-align:center;">
            © ${new Date().getFullYear()} Demand Point Skills and Services.
            All rights reserved.
          </p>
        </div>
      `,
    });

    return response;
  } catch (err) {
    throw err;
  }
}

module.exports = sendPasswordResetEmail;
