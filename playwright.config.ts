import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);
const databaseUrl =
  process.env.DATABASE_URL ?? "sqlite+aiosqlite:///./.data/poker-e2e.db";
const chromiumChannel = process.env.E2E_CHROMIUM_CHANNEL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: isCi ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: isCi
    ? [["line"], ["junit", { outputFile: "test-results/e2e.xml" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : [
        {
          command:
            "node scripts/python.mjs -m alembic -c apps/server/alembic.ini upgrade head && node scripts/python.mjs -m uvicorn app.main:socket_app --app-dir apps/server --host 127.0.0.1 --port 8000",
          url: "http://127.0.0.1:8000/health/ready",
          reuseExistingServer: !isCi,
          timeout: 120_000,
          env: {
            ...process.env,
            APP_ENV: "test",
            DATABASE_URL: databaseUrl,
            APP_SECRET_KEY:
              process.env.APP_SECRET_KEY ??
              "dGVzdC1vbmx5LWhvbGRlbS1zZWNyZXQta2V5LTAwMDEyMzQ1Njc4OQ",
            ALLOWED_ORIGINS: "http://127.0.0.1:5173",
            COOKIE_SECURE: "false",
            AUTO_CREATE_SCHEMA: "false",
          },
        },
        {
          command: "pnpm --filter @holdem/web dev --host 127.0.0.1",
          url: "http://127.0.0.1:5173",
          reuseExistingServer: !isCi,
          timeout: 120_000,
          env: {
            ...process.env,
            VITE_API_BASE_URL: "http://127.0.0.1:8000",
            VITE_SOCKET_URL: "http://127.0.0.1:8000",
          },
        },
      ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumChannel ? { channel: chromiumChannel } : {}),
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        ...(chromiumChannel ? { channel: chromiumChannel } : {}),
      },
    },
  ],
});
