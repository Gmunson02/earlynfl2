/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true, // 🚨 Kill switch: disables all next/image optimizations
    remotePatterns: [
      {
        protocol: "https",
        hostname: "a.espncdn.com",
        pathname: "/**",
      },
    ],
  },
};

module.exports = nextConfig;
