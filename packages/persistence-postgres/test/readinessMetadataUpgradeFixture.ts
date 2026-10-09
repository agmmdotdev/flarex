import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const Journal = Schema.Struct({ version: Schema.String, dialect: Schema.Literal("postgresql"),
  entries: Schema.Array(Schema.Struct({ idx: Schema.Number.check(Schema.isInt()), version: Schema.String,
    when: Schema.Number.check(Schema.isInt()), tag: Schema.String, breakpoints: Schema.Boolean })) });
const decodeJournal = Schema.decodeUnknownSync(Journal);

/** Both drivers install the actual 139 predecessor, then submit the original
 * current migrator. Only this disposable copy's journal is shortened. */
export async function withReadinessMetadataUpgradeMigrations(
  work: (folder: string, exposeCurrentMigrations: () => Promise<void>) => Promise<void>,
) {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-readiness-140-"));
  const folder = resolve(root, "drizzle");
  try {
    await cp(resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle"), folder, { recursive: true });
    const journalPath = resolve(folder, "meta/_journal.json");
    const currentText = await readFile(journalPath, "utf8");
    const journal = decodeJournal(JSON.parse(currentText));
    if (!journal.entries.some(entry => entry.idx === 140 && entry.tag === "0140_readiness_metadata_protection"))
      throw new Error("Missing actual readiness protection migration");
    await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter(entry => entry.idx < 140) }));
    await work(folder, () => writeFile(journalPath, currentText));
  } finally {
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("flarex-readiness-140-"))
      throw new Error("Readiness migration fixture escaped its original temporary directory");
    await rm(root, { recursive: true, force: true });
  }
}
