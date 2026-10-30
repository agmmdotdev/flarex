import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle/core",
  schema: "./src/database/coreDrizzleSchema.ts",
});
