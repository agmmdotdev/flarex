import { readFile, writeFile } from "node:fs/promises";

/** A digest-named file is reusable only when its complete bytes match. Leave a
 * partial/conflicting artifact in place and refuse evidence publication. */
export async function writeSourceArtifact(directory, source) {
  const artifact = `connected-source-${source.sha256}.json`;
  const encoded = JSON.stringify(source, null, 2) + "\n";
  try { await writeFile(`${directory}/${artifact}`, encoded, { flag: "wx" }); }
  catch (cause) {
    if (cause.code !== "EEXIST") throw cause;
    const existing = await readFile(`${directory}/${artifact}`, "utf8");
    if (existing !== encoded) throw new Error("Existing source inventory is incomplete or conflicting", { cause });
  }
  return { sha256: source.sha256, files: source.files, artifact };
}
