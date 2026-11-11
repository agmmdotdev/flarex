import { Data, Result, Schema } from "effect";
import { CoreApplicationRouteIdentitySchema, CoreApplicationTimestampSchema } from "./core-application";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const SourceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const CoreQueryCheckpointSourceIdSchema = SourceId;
export const CORE_QUERY_CHECKPOINT_MAXIMUM_REQUEST_BYTES = 4096;
export const CORE_QUERY_CHECKPOINT_MAXIMUM_RESPONSE_BYTES = 4096;
export const CORE_QUERY_CHECKPOINT_MAXIMUM_ELAPSED_MILLISECONDS = 10_000;

export const CoreQueryCheckpointRequestSchema = Schema.Struct({
  format: Schema.Literal("flarex.core-query-checkpoint.request"),
  version: Schema.Literal(1),
  route: CoreApplicationRouteIdentitySchema,
  after: Schema.NullOr(CoreApplicationTimestampSchema),
  sourceId: Schema.NullOr(SourceId),
  maximumElapsedMilliseconds: Schema.Int.check(Schema.makeFilter(value =>
    value >= 1 && value <= CORE_QUERY_CHECKPOINT_MAXIMUM_ELAPSED_MILLISECONDS ? undefined : "Expected a deadline from 1 to 10000 milliseconds")),
}).check(Schema.makeFilter(value =>
  (value.after === null) === (value.sourceId === null) ? undefined : "Checkpoint position and source identity must both be present or absent")).annotate(strict);
export type CoreQueryCheckpointRequest = typeof CoreQueryCheckpointRequestSchema.Type;

export const CoreQueryCheckpointResponseSchema = Schema.Struct({
  format: Schema.Literal("flarex.core-query-checkpoint.response"),
  version: Schema.Literal(1),
  kind: Schema.Literals(["certified", "historyUnavailable", "sourceReplaced"]),
  route: CoreApplicationRouteIdentitySchema,
  sourceId: SourceId,
  after: Schema.NullOr(CoreApplicationTimestampSchema),
  retainedFrom: CoreApplicationTimestampSchema,
  through: CoreApplicationTimestampSchema,
}).check(Schema.makeFilter(value => {
  const minimum = BigInt(value.retainedFrom);
  const through = BigInt(value.through);
  if (minimum > through) return "Retained edge must not follow the target";
  if (value.kind === "sourceReplaced") return undefined;
  if (value.after === null) return value.kind === "certified" ? undefined : "Fresh reads cannot lose a requested interval";
  const after = BigInt(value.after);
  if (after > through) return "Requested checkpoint must not follow its target";
  return value.kind === "certified"
    ? after >= minimum ? undefined : "Certified interval must be fully retained"
    : after < minimum ? undefined : "History-unavailable evidence must identify a missing interval";
})).annotate(strict);
export type CoreQueryCheckpointResponse = typeof CoreQueryCheckpointResponseSchema.Type;

export class CoreQueryCheckpointProtocolError extends Data.TaggedError("CoreQueryCheckpointProtocolError")<{
  readonly reason: "invalidRequest" | "invalidResponse";
  readonly cause: Schema.SchemaError;
}> {}

const request = Schema.decodeUnknownResult(CoreQueryCheckpointRequestSchema, { onExcessProperty: "error" });
const response = Schema.decodeUnknownResult(CoreQueryCheckpointResponseSchema, { onExcessProperty: "error" });
export const decodeCoreQueryCheckpointRequest = (value: unknown) => request(value).pipe(
  Result.mapError(cause => new CoreQueryCheckpointProtocolError({ reason: "invalidRequest", cause })),
  Result.map(decoded => Object.freeze({ ...decoded, route: Object.freeze({ ...decoded.route }) })),
);
export const encodeCoreQueryCheckpointRequest = decodeCoreQueryCheckpointRequest;
export const decodeCoreQueryCheckpointResponse = (value: unknown) => response(value).pipe(
  Result.mapError(cause => new CoreQueryCheckpointProtocolError({ reason: "invalidResponse", cause })),
  Result.map(decoded => Object.freeze({ ...decoded, route: Object.freeze({ ...decoded.route }) })),
);
export const encodeCoreQueryCheckpointResponse = decodeCoreQueryCheckpointResponse;

export function coreQueryCheckpointPath(deploymentId: string): string {
  return `/applications/${encodeURIComponent(deploymentId)}/query-checkpoint`;
}
