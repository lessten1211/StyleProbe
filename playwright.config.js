import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  workers: 1,
  use: { headless: true, channel: process.env.PW_CHANNEL || undefined },
  reporter: "list",
});
