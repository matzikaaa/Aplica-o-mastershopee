/**
 * Sets a user's password from the command line.
 *
 * Exists for one specific job: the demo account's password is published in
 * this repository's README, which is fine on a laptop and wrong the moment
 * that account exists on a deployed instance — a marketplace reviewer needs a
 * login, and anyone reading the repo would have the same one.
 *
 *   pnpm db:set-password demo@mastershopee.app 'senha-forte-aqui'
 *
 * Prints nothing back except confirmation: the password is already in the
 * caller's hands, and echoing it would put it in the shell history twice.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

// Same scheme as apps/web/src/lib/password.ts — salt:hash, scrypt, 64 bytes.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];

  if (!email || !password) {
    throw new Error("Uso: pnpm db:set-password <email> <senha>");
  }
  if (password.length < 10) {
    throw new Error("Senha curta demais. Use ao menos 10 caracteres — esta conta fica exposta na internet.");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const all = await prisma.user.findMany({ select: { email: true } });
    console.error(`Nenhum usuário com o e-mail "${email}". Cadastrados: ${all.map((u) => u.email).join(", ") || "nenhum"}`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(password),
      // A password reset that leaves the e-mail unconfirmed produces an
      // account that still cannot log in, which is the opposite of the point.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });

  // Any reset link still outstanding would let whoever holds it take the
  // account back over.
  const { count } = await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

  console.log(`Senha de ${email} atualizada.`);
  if (count > 0) console.log(`${count} link(s) de redefinição pendente(s) invalidado(s).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
