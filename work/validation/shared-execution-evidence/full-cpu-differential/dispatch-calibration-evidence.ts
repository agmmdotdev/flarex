import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { ContinuationRecordSchema, ContinuationSourcesSchema } from './continuation-evidence';

const CalibrationSchema = Schema.Struct({
  before: ContinuationSourcesSchema, after: ContinuationSourcesSchema,
  blocks: Schema.Array(Schema.Struct({ block: Schema.Natural, observed: Schema.Boolean,
    iterations: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    threadMs: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)), record: ContinuationRecordSchema })),
  node: Schema.String, v8: Schema.String, method: Schema.String,
});
export type DispatchCalibration = typeof CalibrationSchema.Type;
export function decodeDispatchCalibration(input: unknown): DispatchCalibration {
  const data = Schema.decodeUnknownSync(CalibrationSchema)(input);
  assert.deepEqual(data.before, data.after); assert.equal(data.before.length, 8);
  assert.equal(new Set(data.before.map(s => s.file)).size, data.before.length);
  assert.equal(data.blocks.length, 20); const seen = new Set<string>();
  for (const block of data.blocks) {
    assert(block.block < 10); const key = block.block + ':' + block.observed;
    assert(!seen.has(key)); seen.add(key); assert.equal(block.iterations, 10000);
    const record = block.record;
    assert.equal(record.root, 0); assert.equal(record.ordinal, 0); assert.equal(record.observed, true);
    assert(record.cycles.complete && record.cycles.observed && record.cycles.totalCycles !== null);
    assert.deepEqual(record.cycles.failures, []);
    assert.equal(Number(BigInt(record.rawLast) - BigInt(record.rawFirst)), record.totalCycles);
    assert.equal(record.cycles.totalCycles + record.gcCycles + record.probeCycles, record.totalCycles);
    assert.equal(record.cycles.buckets.find(b => b.site === 'Empty.boundary')?.calls ?? 0, block.observed ? block.iterations : 0);
    assert(record.cycles.buckets.every(b => b.site === 'Empty.boundary' || b.site.startsWith('Gap.')));
  }
  return data;
}
