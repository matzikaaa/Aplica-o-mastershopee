# Worker do Mastershopee — processos longos (filas BullMQ + agendador).
#
# Existe porque a Vercel não mantém processo em execução: o site sobe lá, mas
# sincronização de marketplace, cálculo de métricas e alerta de WhatsApp
# precisam de algo que fique de pé. Esta imagem roda em Railway, Render,
# Fly.io ou qualquer lugar que aceite um contêiner.
#
# Build a partir da RAIZ do repositório, não desta pasta:
#   docker build -f apps/worker/Dockerfile -t mastershopee-worker .
# O worker depende dos pacotes do workspace, que estão fora de apps/worker.

FROM node:20-slim AS base

# openssl: o motor de query do Prisma linka contra ele em tempo de execução.
# ca-certificates: conexões TLS com Neon e Upstash.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# Manifests primeiro: enquanto nenhuma dependência muda, esta camada é
# reaproveitada e o build não repete a instalação.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/financial-engine/package.json packages/financial-engine/
COPY packages/billing/package.json packages/billing/
COPY packages/integrations/package.json packages/integrations/
COPY packages/inventory/package.json packages/inventory/

# --ignore-scripts: o postinstall do packages/database chama prisma generate,
# que precisa do schema — e o schema ainda não foi copiado nesta camada.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter @mastershopee/worker... \
  --filter @mastershopee/database...

COPY packages/ packages/
COPY apps/worker/ apps/worker/

# Gerado no build, não na inicialização: um contêiner que só descobre na hora
# de subir que não consegue gerar o client falha no lugar errado, longe de
# quem poderia corrigir.
RUN pnpm --filter @mastershopee/database exec prisma generate

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@mastershopee/worker", "start"]
