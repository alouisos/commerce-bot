import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    name: "widget",
    environment: "happy-dom",
    include: ["widget/test/**/*.test.{ts,tsx}"],
  },
});
