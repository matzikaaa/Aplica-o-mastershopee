/**
 * Marks a user's e-mail as confirmed, for local development where no SMTP is
 * configured and the verification link only ever reaches the dev server's
 * console.
 *
 * Refuses to run against a production database: skipping e-mail verification
 * there would defeat the check that stops someone registering with an address
 * they do not control (§7, §38).
 *
 *   pnpm db:verify-user voce@exemplo.com
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Recusado: este comando é só para desenvolvimento local.");
  }

  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error("Informe o e-mail: pnpm db:verify-user voce@exemplo.com");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const all = await prisma.user.findMany({ select: { email: true, emailVerifiedAt: true } });
    console.error(`Nenhum usuário com o e-mail "${email}".`);
    console.error("Cadastrados neste banco:");
    for (const u of all) {
      console.error(`  ${u.email} — ${u.emailVerifiedAt ? "confirmado" : "NÃO confirmado"}`);
    }
    process.exit(1);
  }

  if (user.emailVerifiedAt) {
    console.log(`${email} já estava confirmado em ${user.emailVerifiedAt.toLocaleString("pt-BR")}.`);
    console.log("Se o login falha mesmo assim, o problema é a senha ou o NEXTAUTH_URL, não a confirmação.");
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  // Consume the pending tokens: leaving a valid link behind after verifying
  // by hand is a live credential nobody is watching.
  const { count } = await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });

  console.log(`${email} confirmado. Pode fazer login.`);
  if (count > 0) console.log(`${count} link(s) de confirmação pendente(s) invalidado(s).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
