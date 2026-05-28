/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Server actions disabled by default; enable per-action.
  // Env vars read at build time go here; runtime config via process.env.
};

module.exports = nextConfig;
