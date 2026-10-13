import { it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reduceContinuationCampaigns } from './continuation-evidence';
import { readRetainedJson } from './evidence';
import { decodeDispatchCalibration } from './dispatch-calibration-evidence';
import { summarizeDispatch } from './dispatch-summary';
const readCalibration = async () => decodeDispatchCalibration(await readRetainedJson(resolve(import.meta.dirname, 'dispatch-calibration.json')));
it('conserves dispatch campaigns, validates calibration and presents only accepted evidence', async () => {
  const reports = await reduceContinuationCampaigns('dispatch'), calibration = await readCalibration();
  await writeFile(new URL('dispatch-summary.json', import.meta.url), JSON.stringify(summarizeDispatch(reports, calibration), null, 2) + '\n');
});
it('rejects zero iterations, duplicate blocks and broken calibration conservation', async () => {
  const calibration = await readCalibration(), first = calibration.blocks[0]; expect(first).toBeDefined();
  if (!first) throw Error('Missing calibration block');
  expect(() => decodeDispatchCalibration({ ...calibration, blocks: [{ ...first, iterations: 0 }, ...calibration.blocks.slice(1)] })).toThrow();
  expect(() => decodeDispatchCalibration({ ...calibration, blocks: [first, first, ...calibration.blocks.slice(2)] })).toThrow();
  expect(() => decodeDispatchCalibration({ ...calibration, blocks: [{ ...first, record: { ...first.record, probeCycles: first.record.probeCycles + 1 } },
    ...calibration.blocks.slice(1)] })).toThrow();
});
