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

/**
 * E-mail de conferência para o próprio operador.
 *
 * Deliberadamente passa pelo mesmo `send` dos e-mails reais: um caminho de
 * teste próprio provaria que o caminho de teste funciona, que não é a
 * pergunta.
 */
export async function sendTestEmail(to: string, name: string) {
  await send(
    to,
    "Teste de envio — Mastershopee",
    `<p>Olá, ${name}!</p>` +
      `<p>Se você recebeu este e-mail, a entrega está funcionando: confirmação de cadastro e ` +
      `recuperação de senha vão chegar aos seus clientes.</p>` +
      `<p style="color:#666;font-size:12px">Enviado em ${new Date().toLocaleString("pt-BR")}.</p>`,
  );
}

/**
 * O resumo diário por e-mail.
 *
 * Mesmo conteúdo do WhatsApp, e de propósito: o vendedor que recebe pelos
 * dois canais não pode ver números diferentes. O que muda é só a forma — no
 * e-mail cabe a tabela e a lista inteira de produtos a repor, que na mensagem
 * precisa ser cortada em cinco para caber numa tela de celular.
 */
export async function sendDailyReportEmail(opts: {
  to: string;
  workspaceName: string;
  periodo: string;
  faturamento: string;
  lucro: string;
  margem: string;
  pedidos: string;
  ads: string;
  estoque: { sku: string; quantity: number; daysOfCover: number | null; isOutOfStock: boolean }[];
  painelUrl: string;
}) {
  const linha = (rotulo: string, valor: string, destaque = false) =>
    `<tr>
       <td style="padding:6px 0;color:#555">${rotulo}</td>
       <td style="padding:6px 0;text-align:right;font-weight:${destaque ? 700 : 400}">${valor}</td>
     </tr>`;

  const estoqueHtml =
    opts.estoque.length === 0
      ? `<p style="color:#2e7d32;margin:16px 0 0">Nenhum produto precisa de reposição.</p>`
      : `<p style="margin:20px 0 6px;font-weight:600">Repor estoque</p>
         <table style="width:100%;border-collapse:collapse;font-size:14px">
           ${opts.estoque
             .map(
               (i) => `<tr>
                 <td style="padding:6px 0;font-family:ui-monospace,monospace">${i.sku}</td>
                 <td style="padding:6px 0;text-align:right;color:${i.isOutOfStock ? "#c62828" : "#555"}">
                   ${i.quantity} un · ${
                     i.isOutOfStock
                       ? "ZERADO"
                       : i.daysOfCover === null
                         ? "sem histórico"
                         : `${i.daysOfCover.toFixed(0)} dias`
                   }
                 </td>
               </tr>`,
             )
             .join("")}
         </table>`;

  await send(
    opts.to,
    `Resultado de ${opts.periodo} — ${opts.workspaceName}`,
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;color:#111">
       <h2 style="margin:0 0 4px;font-size:18px">Resultado de ${opts.periodo}</h2>
       <p style="margin:0 0 20px;color:#666;font-size:14px">${opts.workspaceName}</p>

       <table style="width:100%;border-collapse:collapse;font-size:14px">
         ${linha("Faturamento", opts.faturamento)}
         ${linha("Lucro líquido", opts.lucro, true)}
         ${linha("Margem", opts.margem)}
         ${linha("Pedidos", opts.pedidos)}
         ${linha("Investimento em anúncios", opts.ads)}
       </table>

       ${estoqueHtml}

       <p style="margin:24px 0 0"><a href="${opts.painelUrl}" style="color:#1565c0">Ver detalhes por produto no painel</a></p>
       <p style="margin:24px 0 0;color:#999;font-size:12px">
         Para parar de receber, desative o resumo diário em Configurações.
       </p>
     </div>`,
  );
}
