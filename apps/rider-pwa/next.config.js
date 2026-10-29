/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL || "http://localhost:3001";

module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs in CI (`pnpm lint`), not during the build.
  eslint: { ignoreDuringBuilds: true },
  // The PWA only talks to services/api. Proxying keeps the browser same-origin (no CORS, no secrets in the client).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};
