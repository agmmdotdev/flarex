import { Schema } from "effect";
import { CycleEvidenceSchema } from "../../../../packages/executor/test/performance/measurement/cycleAttribution";
import { RootCounterPairSchema } from "../../../../packages/executor/test/performance/measurement/rootCounters";

export const IdentitySchema = Schema.Union([
  Schema.Struct({ id: Schema.Natural, kind: Schema.Literals(["object", "string", "function", "symbol"]), length: Schema.optionalKey(Schema.Natural) }),
  Schema.Struct({ kind: Schema.Literal("scalar"), value: Schema.Union([Schema.Finite, Schema.Boolean, Schema.Null]) }),
  Schema.Struct({ kind: Schema.Literals(["number", "bigint"]), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("undefined") }),
]);
export type Identity = typeof IdentitySchema.Type;
export const EdgeSchema = Schema.Struct({ site: Schema.String, phase: Schema.String, parent: Schema.NullOr(Schema.String),
  caller: Schema.optionalKey(Schema.UndefinedOr(Schema.String)), inputs: Schema.Array(IdentitySchema),
  output: Schema.optionalKey(IdentitySchema), threw: Schema.optionalKey(Schema.Literal(true)) });
export type Edge = { -readonly [Key in keyof typeof EdgeSchema.Type]: typeof EdgeSchema.Type[Key] };
const RequestSchema = Schema.Struct({ id: Schema.String, index: Schema.Natural, kind: Schema.String, lane: Schema.String });
export type Request = typeof RequestSchema.Type;
const SourceSchema = Schema.Struct({ file: Schema.String, originalHash: Schema.String, transformedHash: Schema.String, sites: Schema.Array(Schema.String) });
export type Source = typeof SourceSchema.Type;
const ObserverSource = Schema.Struct({ file: Schema.String, sha256: Schema.String });
export const ArtifactSchema = Schema.Struct({ rawPath: Schema.optionalKey(Schema.UndefinedOr(Schema.String)), readerHash: Schema.String, reverse: Schema.Boolean,
  observerSources: Schema.Array(ObserverSource), observerSourcesAfter: Schema.Array(ObserverSource), sources: Schema.Array(SourceSchema),
  requests: Schema.Array(Schema.Struct({ ...RequestSchema.fields, enabled: Schema.Boolean, edges: Schema.Array(EdgeSchema), identities: Schema.Natural,
    cycles: Schema.optionalKey(Schema.UndefinedOr(CycleEvidenceSchema)), faults: Schema.Array(Schema.String) })) });
export const RawProjectionSchema = Schema.Struct({ cleanup: Schema.String, gates: Schema.Array(Schema.Struct({ passed: Schema.Boolean })),
  samples: Schema.Array(Schema.Struct({ outcome: Schema.String })), cpuPairs: Schema.Array(RootCounterPairSchema) });
export const decodeArtifact = Schema.decodeUnknownSync(ArtifactSchema);
export const decodeRawProjection = Schema.decodeUnknownSync(RawProjectionSchema);
