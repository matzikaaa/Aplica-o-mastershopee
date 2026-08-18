/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@mastershopee/database",
    "@mastershopee/shared",
    "@mastershopee/financial-engine",
    "@mastershopee/billing",
    "@mastershopee/integrations",
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
