import { defineConfig } from 'vitest/config';

// Kept out of the default run: it needs the files the Python export writes.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.parity.test.ts'],
  },
});
