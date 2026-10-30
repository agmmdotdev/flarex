import { defineConfig } from "drizzle-kit";

/** Retained only for named old native/catalog consumers until their cutover. */
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/database/drizzleSchema.ts",
});
