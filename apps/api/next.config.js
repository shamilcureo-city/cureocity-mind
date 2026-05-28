/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API app has no UI; React is only a peer for Next's compiler.
  // Disable image optimization etc. by not configuring them.
  experimental: {
    // Vercel Functions runtime defaults to nodejs20.x; we want to ride
    // the most recent supported runtime so newer Node APIs work.
    serverComponentsExternalPackages: ['@prisma/client', '@prisma/adapter-neon', 'firebase-admin'],
  },
};

module.exports = nextConfig;
