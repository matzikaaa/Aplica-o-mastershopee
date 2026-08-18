import nodemailer from "nodemailer";

/**
 * Transactional email (verification, password reset — §7). Sends via SMTP
 * when EMAIL_SERVER_* env vars are configured; otherwise falls back to
 * logging the link to the server console so local development and this
 * environment (no real SMTP credentials configured, §57) still work
 * end-to-end without a fake "email sent" success message.
 */
function getTransport() {
  const host = process.env.EMAIL_SERVER_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
    auth: process.env.EMAIL_SERVER_USER
      ? { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD }
      : undefined,
  });
}

async function send(to: string, subject: string, html: string) {
  const transport = getTransport();
  if (!transport) {
    // eslint-disable-next-line no-console
    console.log(`[email:dev-fallback] to=${to} subject="${subject}"\n${html}`);
    return;
  }
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? "Mastershopee <no-reply@mastershopee.app>", to, subject, html });
}

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  await send(
    to,
    "Confirme seu e-mail — Mastershopee",
    `<p>Olá, ${name}!</p><p>Confirme seu e-mail para ativar sua conta:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>O link expira em 24 horas.</p>`,
  );
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await send(
    to,
    "Redefinir senha — Mastershopee",
    `<p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Se você não pediu isso, ignore este e-mail. O link expira em 1 hora.</p>`,
  );
}
