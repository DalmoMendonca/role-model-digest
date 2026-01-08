import "./env.js";
import nodemailer from "nodemailer";

const SMTP_URL = process.env.SMTP_URL;
const EMAIL_FROM =
  process.env.EMAIL_FROM || "Role Model Digest <digest@rolemodeldigest.com>";

function getClientOrigin() {
  const origin =
    process.env.CLIENT_ORIGIN ||
    process.env.CORS_ORIGIN ||
    "http://localhost:5173";
  return origin.replace(/\/$/, "");
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendDigestEmail({ to, subject, html, text }) {
  if (!SMTP_URL) {
    return { status: "skipped" };
  }

  const transporter = nodemailer.createTransport(SMTP_URL);
  return transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    html,
    text
  });
}

export async function sendInviteEmail({ to, inviterName, roleModelName }) {
  if (!SMTP_URL) {
    return { status: "skipped" };
  }

  const safeInviter = escapeHtml(inviterName || "A friend");
  const safeRoleModel = escapeHtml(roleModelName || "a role model");
  const origin = getClientOrigin();
  const joinUrl = `${origin}/`;

  const subject = `${inviterName || "A friend"} invited you to Role Model Digest`;
  const html = `
    <div style="margin:0 auto;max-width:640px;padding:24px 18px;font-family:Arial, sans-serif;color:#1d1a16;background:#fffaf4;border:1px solid #f3e6d8;border-radius:20px;">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8c7b6b;margin-bottom:10px;">Role Model Digest</div>
      <h2 style="font-size:26px;margin:0 0 10px;">You're invited</h2>
      <p style="font-size:16px;line-height:1.7;color:#2e2b27;margin:0 0 14px;">
        ${safeInviter} invited you to Role Model Digest, a weekly briefing that makes it effortless to follow a living role model.
      </p>
      <div style="padding:14px 16px;border-radius:16px;background:#fff3e6;border:1px solid #f2d8c2;margin-bottom:18px;">
        <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6c5a4d;margin-bottom:6px;">Why they invited you</div>
        <div style="font-size:15px;line-height:1.6;color:#3d3a35;">
          They're tracking <strong>${safeRoleModel}</strong> and want you to build your own focused summary.
        </div>
      </div>
      <ul style="padding-left:18px;margin:0 0 20px;color:#3d3a35;font-size:14px;line-height:1.7;">
        <li>Pick a living role model with a real online footprint.</li>
        <li>Get weekly summaries across news, social, and video.</li>
        <li>Share and compare digests with peers.</li>
      </ul>
      <a href="${joinUrl}" style="display:inline-block;background:#ff6b2d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;">
        Accept invitation
      </a>
      <p style="margin-top:18px;font-size:12px;color:#8c7b6b;">
        If you weren't expecting this, you can ignore the email.
      </p>
    </div>
  `;

  const text =
    `${inviterName || "A friend"} invited you to Role Model Digest.\n\n` +
    `They're tracking ${roleModelName || "a role model"} and want you to build your own digest.\n\n` +
    `Join: ${joinUrl}`;

  const transporter = nodemailer.createTransport(SMTP_URL);
  return transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    html,
    text
  });
}
