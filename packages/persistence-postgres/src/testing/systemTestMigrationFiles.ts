import { cp } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/** Drizzle executes SQL and its journal; generator snapshots are not runtime inputs. */
export async function copyDrizzleMigrations(
  source: string,
  destination: string,
): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    filter: path => {
      const entry = relative(source, path);
      return entry === "" || entry === "meta" ||
        entry === join("meta", "_journal.json") ||
        (dirname(entry) === "." && entry.endsWith(".sql"));
    },
  });
}
