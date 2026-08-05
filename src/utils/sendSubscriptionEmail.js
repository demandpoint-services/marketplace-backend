const resend = require("../config/resend");

const FROM_ADDRESS =
  "Demand Point Skills and Services <noreply@mail.demandpoint.app>";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailHtml({
  eyebrow = "DemandPoint Professional",
  title,
  greeting,
  paragraphs = [],
  highlight = null,
  buttonLabel = "Manage subscription",
  buttonUrl,
  footerNote = "This is an automated message about your DemandPoint account.",
}) {
  const safeButtonUrl = escapeHtml(buttonUrl || "https://demandpoint.app/settings?section=subscription");

  return `
    <div style="background:#f5f5f7;padding:32px 12px;font-family:Arial,sans-serif;color:#171717;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e9e9ee;">
        <div style="padding:34px 34px 22px;background:linear-gradient(135deg,#12002f,#7c3bff);color:#ffffff;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#d8c9ff;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0;font-size:28px;line-height:1.25;">${escapeHtml(title)}</h1>
        </div>

        <div style="padding:32px 34px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">${escapeHtml(greeting)}</p>

          ${paragraphs
            .map(
              (paragraph) =>
                `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#4b4b55;">${escapeHtml(paragraph)}</p>`,
            )
            .join("")}

          ${
            highlight
              ? `<div style="margin:24px 0;padding:18px 20px;border-radius:14px;background:#f4f0ff;border:1px solid #ded2ff;">
                  <p style="margin:0;font-size:16px;line-height:1.6;font-weight:700;color:#5f20d7;">${escapeHtml(highlight)}</p>
                </div>`
              : ""
          }

          <a href="${safeButtonUrl}" style="display:inline-block;margin-top:8px;padding:14px 22px;border-radius:12px;background:#7c3bff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(buttonLabel)}</a>

          <hr style="margin:32px 0 20px;border:none;border-top:1px solid #ececf1;" />

          <p style="margin:0;font-size:12px;line-height:1.6;color:#8a8a94;">${escapeHtml(footerNote)}</p>
          <p style="margin:10px 0 0;font-size:12px;color:#a0a0aa;">© ${new Date().getFullYear()} Demand Point Skills and Services.</p>
        </div>
      </div>
    </div>
  `;
}

async function sendSubscriptionEmail({ to, subject, html }) {
  if (!to) {
    throw new Error("Subscription email recipient is required.");
  }

  const response = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });

  if (response?.error) {
    throw new Error(response.error.message || "Unable to send subscription email.");
  }

  return response?.data || response;
}

module.exports = {
  buildEmailHtml,
  sendSubscriptionEmail,
};
