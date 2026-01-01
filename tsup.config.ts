import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/index": "src/adapters/index.ts",
    "providers/index": "src/providers/index.ts",
    "middleware/index": "src/middleware/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    "openai",
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "groq-sdk",
    "@cerebras/cerebras_cloud_sdk",
    "mongodb",
    "pg",
  ],
});
