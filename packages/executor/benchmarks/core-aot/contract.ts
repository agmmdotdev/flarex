import { Schema } from "effect";

export const RequestMeasurement = Schema.Struct({
  index: Schema.Int, phase: Schema.Literals(["warmup", "measured"]),
  wallMs: Schema.Finite, userCpuMs: Schema.Finite, systemCpuMs: Schema.Finite,
  completed: Schema.Boolean, verified: Schema.Boolean,
});
export const ServerObservation = Schema.Struct({
  version: Schema.String, database: Schema.String, role: Schema.String,
  fsync: Schema.String, fullPageWrites: Schema.String, synchronousCommit: Schema.String,
  superuser: Schema.Boolean, bypassRls: Schema.Boolean, createDb: Schema.Boolean,
  createRole: Schema.Boolean, replication: Schema.Boolean,
});
export const RequestWorkerResult = Schema.Struct({
  status: Schema.Literals(["passed", "failed"]),
  versions: Schema.Record(Schema.String, Schema.String),
  driver: Schema.Literal("postgres"), scenario: Schema.Literal("mixed-product"),
  measurementMode: Schema.Literals(["quiet", "cpu-diagnostic"]),
  warmups: Schema.Int, samples: Schema.Int,
  server: Schema.NullOr(ServerObservation),
  measurements: Schema.Array(RequestMeasurement),
  failureStage: Schema.NullOr(Schema.String),
  disposed: Schema.Boolean,
  profiles: Schema.Array(Schema.Struct({ index: Schema.Int, file: Schema.String, sha256: Schema.String,
    samples: Schema.Int, spanUs: Schema.Finite })),
});
export type RequestMeasurement = typeof RequestMeasurement.Type;

export const RequestBuildManifest = Schema.Struct({
  sourceRevision: Schema.String, gitStatus: Schema.String, nodeVersion: Schema.String,
  bunVersion: Schema.String,
  builds: Schema.Array(Schema.Struct({ mode: Schema.Literals(["generated", "interpreter"]),
    runtime: Schema.Literals(["node", "bun-aot"]), artifact: Schema.String, sha256: Schema.String,
    bundleSha256: Schema.String, sourceMapSha256: Schema.String, bytes: Schema.Int })),
});
