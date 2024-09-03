import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  noExternal: ["openai"],
  platform: "neutral",
});
