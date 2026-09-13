import type { NextConfig } from 'next';

/**
 * `@educlm/contracts` is a file: link into ../backend/packages/contracts whose
 * `dist/` is rebuilt whenever the API's contract changes.
 *
 * Webpack treats everything under node_modules as a package-manager install: it
 * caches those files by package name and version instead of by content, and the
 * dev watcher ignores them. The contracts package is always 0.1.0, so a rebuilt
 * contract was never re-read — not on save, not on restart, because the cache in
 * `.next/cache` outlives the process. The frontend kept validating responses
 * against the old schema, and the first new enum value the API sent (a practice
 * set's `generating` status) was rejected as "an unexpected answer".
 */
const CONTRACTS = /[\\/]node_modules[\\/]@educlm[\\/]contracts[\\/]/;

/** Next's default ignore list (.git, .next, node_modules), minus the contracts package. */
const WATCH_IGNORED = /[\\/](?:\.git|\.next)(?:[\\/]|$)|[\\/]node_modules[\\/](?!@educlm[\\/]contracts[\\/])/;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Keeping the symlink path means the contracts' `zod` import resolves from
    // this app's node_modules instead of the backend workspace, which is not
    // installed here.
    config.resolve.symlinks = false;

    // Re-read the contracts by timestamp, like source files.
    config.snapshot = {
      ...config.snapshot,
      unmanagedPaths: [...(config.snapshot?.unmanagedPaths ?? []), CONTRACTS],
    };

    // And pick up a rebuild while `next dev` is running.
    config.watchOptions = { ...config.watchOptions, ignored: WATCH_IGNORED };

    return config;
  },
};

export default nextConfig;
