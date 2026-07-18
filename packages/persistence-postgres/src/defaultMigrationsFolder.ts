import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolves the Drizzle migrations shipped beside this persistence package. */
export function defaultMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}
