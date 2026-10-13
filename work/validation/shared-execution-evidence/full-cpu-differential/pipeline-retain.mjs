import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

// Run only after the campaigns settle. Keep lossless raw reports and candidate
// patches so failed runtime variants remain reproducible without being active.
const directory = import.meta.dirname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const labels = (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && /^pipeline-(baseline|handoff|composition|reverted)-[ab]$/.test(entry.name))
  .map(entry => entry.name).sort();
const manifest = [];
for (const label of labels) {
  const files = (await readdir(resolve(directory, label))).filter(file => /^[a-f0-9-]{36}\.json$/.test(file));
  assert.equal(files.length, 1);
  const path = `${label}/${files[0]}`;
  const original = await readFile(resolve(directory, path));
  const packed = gzipSync(original, { level: 9 });
  await writeFile(resolve(directory, path + '.gz'), packed);
  assert.deepEqual(gunzipSync(await readFile(resolve(directory, path + '.gz'))), original);
  manifest.push({ path, bytes: original.length, sha256: hash(original), gzipBytes: packed.length, gzipSha256: hash(packed) });
}
const patches = [];
for (const path of ['pipeline-handoff.patch', 'pipeline-composition.patch', 'pipeline-witness.patch', 'pipeline-handoff-witness.patch']) {
  const bytes = await readFile(resolve(directory, path));
  const packed = gzipSync(bytes, { level: 9 });
  await writeFile(resolve(directory, path + '.gz'), packed);
  assert.deepEqual(gunzipSync(await readFile(resolve(directory, path + '.gz'))), bytes);
  patches.push({ path, bytes: bytes.length, sha256: hash(bytes), gzipBytes: packed.length, gzipSha256: hash(packed) });
}
await writeFile(resolve(directory, 'pipeline-artifacts.json'), JSON.stringify({ base: '67e89e5bc', campaigns: manifest, patches }, null, 2) + '\n');
