import nodemailer from "nodemailer";

/**
 * E-mail transacional (verificação de conta, recuperação de senha — §7).
 *
 * Sem SMTP configurado, o link ia para o console do servidor. Em
 * desenvolvimento isso é o certo — não há caixa de entrada para conferir. Em
 * produção é uma armadilha: o cadastro responde "enviamos um e-mail", ninguém
 * recebe nada, e quem esquece a senha fica trancado para sempre sem que
 * nenhum erro apareça em lugar nenhum.
 *
 * Então o fallback continua existindo, mas só fora de produção. Em produção,
 * SMTP ausente é erro — quem chamou decide o que dizer ao usuário, e o
 * cadastro deixa de prometer um e-mail que não existe.
 */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Envio de e-mail não configurado (EMAIL_SERVER_HOST). Sem isso, verificação de conta e recuperação de senha não chegam a ninguém.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.EMAIL_SERVER_HOST);
}
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
    if (process.env.NODE_ENV === "production") throw new EmailNotConfiguredError();
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
