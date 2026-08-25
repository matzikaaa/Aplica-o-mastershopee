const isDev = process.env.NODE_ENV !== "production";

// §38. script-src and style-src both need 'unsafe-inline': Next.js App
// Router renders its own inline <script> tags on every page (RSC payload
// streaming) that a static header can't nonce — nonce-based CSP requires
// reading the nonce via headers() in a Server Component, which forces every
// page into dynamic rendering, including the marketing pages that are
// static today. Given this app has no dangerouslySetInnerHTML, no raw HTML
// rendering of user input, and no third-party script embeds (verified by
// grep across apps/web/src), the marginal script-injection protection a
// nonce would add isn't worth trading away static rendering for. The rest
// of the policy — no cross-origin fetches/images/fonts, no framing, no
// object embeds, restricted form targets — still meaningfully narrows the
// attack surface.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@mastershopee/database",
    "@mastershopee/shared",
    "@mastershopee/financial-engine",
    "@mastershopee/billing",
    "@mastershopee/integrations",
    "@mastershopee/inventory",
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // O motor de query do Prisma e um binario, nao um import: o rastreamento
    // de arquivos do Next nao o enxerga sozinho, e menos ainda dentro da
    // arvore simbolica que o pnpm monta. Sem isso ele fica de fora do pacote
    // da funcao serverless e a rota estoura com "could not locate the Query
    // Engine" — em execucao, com o build todo verde.
    // A chave casa com o *caminho da rota*, onde grupos como (dashboard) nao
    // aparecem — uma chave "/(dashboard)/**/*" nao casa com nada, e as
    // paginas do painel subiam sem o motor enquanto as rotas de API
    // funcionavam. Um glob unico cobre os dois e nao tem como divergir.
    outputFileTracingIncludes: {
      "/**/*": ["../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node"],
    },
  },
  // Security headers (§38) — applied to every response, including API routes.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
