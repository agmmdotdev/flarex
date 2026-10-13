import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { it } from "vitest";
import { decodeRaw, validateCampaign } from "./evidence";

const directory = import.meta.dirname;
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const left = sorted[Math.floor((sorted.length - 1) / 2)], right = sorted[Math.floor(sorted.length / 2)];
  assert(left !== undefined && right !== undefined);
  return (left + right) / 2;
};

it("validates and summarizes each separate document-pipeline campaign", async () => {
  const labels = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^pipeline-(baseline|handoff|composition|reverted)-[ab]$/.test(entry.name))
    .map(entry => entry.name).sort();
  assert(labels.length >= 2);
  const campaigns = [];
  const variantSources = new Map<string, string>();
  for (const label of labels) {
    const files = await readdir(join(directory, label));
    const originals = [...new Set(files.filter(file => /^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(file)).map(file => file.replace(/\.gz$/, "")))];
    assert.equal(originals.length, 1);
    const original = originals[0]; assert(original !== undefined);
    const file = files.includes(original + ".gz") ? original + ".gz" : original;
    const bytes = await readFile(join(directory, label, file));
    const raw = decodeRaw(JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8")));
    validateCampaign(raw, "control");
    assert.equal(raw.execution, "complete"); assert.equal(raw.cleanup, "completed");
    assert(raw.gates.length > 0 && raw.gates.every(gate => gate.passed));
    assert.equal(raw.sources.before, raw.sources.after);
    assert(raw.samples.every(sample => sample.outcome === "success"));
    const variant = label.replace(/-[ab]$/, "");
    const priorSource = variantSources.get(variant);
    if (priorSource !== undefined) assert.equal(raw.sources.before, priorSource);
    variantSources.set(variant, raw.sources.before);
    const counters = (key: "process" | "thread") => {
      const pairs = raw.cpuPairs.map(pair => { const value = pair[key]; assert(value !== null); return value; });
      const native = pairs.map(pair => (pair.nativeUserMicroseconds + pair.nativeSystemMicroseconds) / 1000);
      const flarex = pairs.map(pair => (pair.flarexUserMicroseconds + pair.flarexSystemMicroseconds) / 1000);
      const added = pairs.map(pair => pair.addedTotalMicroseconds / 1000);
      return { nativeMeanMs: mean(native), flarexMeanMs: mean(flarex), addedMeanMs: mean(added), addedMedianMs: median(added),
        consecutiveTenPairMeansMs: [0, 10, 20, 30].map(start => mean(added.slice(start, start + 10))) };
    };
    campaigns.push({ label, runId: raw.runId, sourceHash: raw.sources.before, samples: raw.cpuPairs.length,
      thread: counters("thread"), process: counters("process") });
  }
  await writeFile(join(directory, "pipeline-summary.json"), JSON.stringify(campaigns, null, 2) + "\n");
  console.log(JSON.stringify(campaigns));
});
