import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
    serverActions: {
      bodySizeLimit: "50mb"
    }
  },
  webpack: (config) => {
    // pdfjs-dist references 'canvas' optionally — alias it to false to avoid
    // bundling errors when used in the browser via dynamic import
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false
    };
    return config;
  }
};

export default nextConfig;
