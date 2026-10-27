import { mkdir, writeFile } from "node:fs/promises";
import { writeSourceArtifact } from "./measurement-artifact.mjs";
import { failureEvidence } from "./measurement-errors.mjs";

/** Evidence failures must not prevent an independent attempt to save the main
 * rejected receipt. Retain inline source evidence if its artifact cannot save. */
export async function recordMeasurement(directory, filename, report) {
  const failures = [];
  const attempt = async (stage, work) => {
    try { return await work(); }
    catch (cause) {
      failures.push(cause); report.status = "failed-evidence-recording";
      report.failures.push({ stage, evidence: failureEvidence(cause) }); return undefined;
    }
  };
  await attempt("evidence-directory", () => mkdir(directory, { recursive: true }));
  if (report.sourceAtStart?.inventory !== undefined) {
    const compact = await attempt("initial-source-artifact", () => writeSourceArtifact(directory, report.sourceAtStart));
    if (compact !== undefined) report.sourceAtStart = compact;
  }
  for (const phase of ["before", "after"]) if (report.source?.[phase]?.inventory !== undefined) {
    const compact = await attempt(`${phase}-source-artifact`, () => writeSourceArtifact(directory, report.source[phase]));
    if (compact !== undefined) report.source[phase] = compact;
  }
  await attempt("main-receipt", () => writeFile(`${directory}/${filename}`, JSON.stringify(report, null, 2) + "\n"));
  return failures;
}
