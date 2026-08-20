import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {
    // Server Actions は既定で有効。ボディ上限は CSV 取込等を見越して少しだけ広げる
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
