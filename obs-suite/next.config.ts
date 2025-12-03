import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Video files in public directory are served statically
  // No special configuration needed for Turbopack
  turbopack: {},
};

export default nextConfig;
