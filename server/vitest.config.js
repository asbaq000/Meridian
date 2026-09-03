import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration test files truncate shared tables, so they must not run
    // concurrently with each other. Concurrency *within* a test (the whole
    // point of concurrency.test.js) is unaffected: that races real HTTP
    // requests and real pool connections inside a single file.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.js'],
  },
});
