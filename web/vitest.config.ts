import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The parity test needs the Python export's output, so it has its own command.
    exclude: [...configDefaults.exclude, '**/*.parity.test.ts'],
  },
});
