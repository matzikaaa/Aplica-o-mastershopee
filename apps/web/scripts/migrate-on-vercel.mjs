/**
 * Aplica as migrations pendentes durante o build de produção da Vercel.
 *
 * Antes isso era um passo manual na máquina de quem faz o deploy, com a
 * connection string de produção na mão. Passo manual em deploy é passo
 * esquecido, e o preço de esquecer é cruel: o build passa verde, o site sobe,
 * e a primeira requisição que toca a coluna nova explode em erro de banco —
 * uma falha de runtime cuja causa está três telas atrás, num comando que
 * ninguém lembra de ter pulado.
 *
 * Só em produção: um deploy de preview rodando migration apontaria para o
 * mesmo banco e aplicaria a mudança antes de o código dela existir no ar.
 *
 * E falha o build de propósito se a migration falhar. Subir código que espera
 * uma coluna que não existe é pior do que não subir.
 */
import { execFileSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") {
  console.log("[migrations] fora do build de produção da Vercel — nada a aplicar.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[migrations] DATABASE_URL ausente no build de produção. Configure antes de publicar.");
  process.exit(1);
}

console.log("[migrations] aplicando migrations pendentes…");
execFileSync(
  "pnpm",
  ["exec", "prisma", "migrate", "deploy", "--schema=../../packages/database/prisma/schema.prisma"],
  { stdio: "inherit" },
);
console.log("[migrations] banco em dia.");
