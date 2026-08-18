import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      CREDENTIALS_ENCRYPTION_KEY: "LQ7bSXe3oldo1jrMTwMgzdm3i98/bqz+30PEW5ejQQg=",
    },
  },
});
