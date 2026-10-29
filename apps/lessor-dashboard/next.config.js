/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL || "http://localhost:3001";

module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs in CI (`pnpm lint`), not during the build.
  eslint: { ignoreDuringBuilds: true },
  // The dashboard only talks to services/api, same-origin through this proxy.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};
