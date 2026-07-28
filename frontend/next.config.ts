import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @educlm/contracts is a file: link into ../backend/packages/contracts. Keeping
  // the symlink path means its `zod` import resolves from this app's node_modules
  // instead of the backend workspace, which is not installed here.
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
