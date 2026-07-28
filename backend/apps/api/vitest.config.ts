import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The analytics suite is pure and fast; nothing here should need a DB.
    testTimeout: 15_000,
  },
});
