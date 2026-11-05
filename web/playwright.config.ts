import { defineConfig, devices } from '@playwright/test';

// The browser tests run against the production build served by `vite preview`,
// so they see the same files a visitor gets. One fixed port; a busy port fails
// the run instead of quietly testing another server.
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  // A flaky browser test is a finding, not something to retry past.
  retries: 0,
  forbidOnly: true,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
});
