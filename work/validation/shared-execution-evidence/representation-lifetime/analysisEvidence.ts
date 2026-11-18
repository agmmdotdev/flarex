import { Schema } from 'effect';
import { RawProjectionSchema } from './evidence';
// The reader needs two additional SDK header fields. Preserve the measured
// producer schema byte-for-byte and compose this analysis-only projection.
export const decodeAnalysisRaw = Schema.decodeUnknownSync(Schema.Struct({
  ...RawProjectionSchema.fields, runId: Schema.String, execution: Schema.String,
}));
