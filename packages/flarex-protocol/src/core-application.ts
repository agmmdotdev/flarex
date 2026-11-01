import { Data, Encoding, Result, Schema } from "effect";
import { ExecutionIdentitySchema } from "./auth";
import { isCanonicalUuidTextV1 } from "./canonical-uuid";
import { captureDocumentObject, decodeDocumentValue, encodeDocumentValue,
  type DocumentObject, type DocumentValue } from "./document-value";
import { JsonValue, type Json } from "./json";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "./transaction-session";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Uuid = Schema.String.check(Schema.makeFilter(value =>
  isCanonicalUuidTextV1(value) ? undefined : "Expected a canonical UUID"));
const Timestamp = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,18})$/),
  Schema.makeFilter(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 0x7fff_ffff_ffff_ffffn
    ? undefined : "Expected a nonnegative signed-64-bit timestamp"));
const Hex = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})*$/));
const InternalId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));
const Interval = Schema.Struct({ start: Schema.NullOr(Hex), end: Schema.NullOr(Hex) }).annotate(strict);
const Read = Schema.Struct({ indexId: InternalId, intervals: Schema.Array(Interval) }).annotate(strict);
const Frontier = Schema.Struct({ timestamp: Timestamp, reads: Schema.Array(Read) }).annotate(strict);
const Evaluation = Schema.Struct({ timestamp: Timestamp, reads: Schema.Array(Read),
  metadataReadFrontiers: Schema.optionalKey(Schema.Array(Frontier)) }).annotate(strict);
const Route = Schema.Struct({ deploymentId: Text, scopeUuid: Uuid, epochUuid: Uuid }).annotate(strict);
export type CoreApplicationRouteIdentity = typeof Route.Type;

const requestHeader = {
  format: Schema.Literal("flarex.core-application.request"), version: Schema.Literal(1),
  kind: Schema.Literals(["query", "mutation"]), functionPath: TransactionFunctionPathV1Schema,
  requestKey: TransactionRequestKeyV1Schema, sourceArtifactRootSha256: Sha256,
  auth: ExecutionIdentitySchema, args: JsonValue,
};
const RequestWire = Schema.Struct(requestHeader).annotate(strict);
export type CoreApplicationInvocationRequest = Omit<typeof RequestWire.Type, "args"> & Readonly<{ args: DocumentObject }>;
const RegistrationWire = Schema.Struct({ format: Schema.Literal("flarex.core-application.registration"),
  version: Schema.Literal(1), requestKey: TransactionRequestKeyV1Schema,
  sourceArtifactRootSha256: Sha256 }).annotate(strict);
export type CoreApplicationRegistrationRequest = typeof RegistrationWire.Type;
const CoreProfile = Schema.Struct({ format: Schema.Literal("flarex.core-application.profile"), version: Schema.Literal(1),
  kind: Schema.Literal("core"), route: Route, sourceArtifactRootSha256: Sha256, sourcePackageHash: Sha256 }).annotate(strict);
const Profile = Schema.Union([CoreProfile, Schema.Struct({ format: Schema.Literal("flarex.core-application.profile"),
  version: Schema.Literal(1), kind: Schema.Literal("legacy"), deploymentId: Text }).annotate(strict)]);
export type CoreApplicationCoreProfile = typeof CoreProfile.Type;
export type CoreApplicationProfile = typeof Profile.Type;

export interface CoreApplicationIndexRead {
  readonly indexId: Uint8Array;
  readonly intervals: readonly Readonly<{ start: Uint8Array | null; end: Uint8Array | null }>[];
}
export interface CoreApplicationEvaluation {
  readonly timestamp: bigint;
  readonly reads: readonly CoreApplicationIndexRead[];
  readonly metadataReadFrontiers?: readonly Readonly<{ timestamp: bigint; reads: readonly CoreApplicationIndexRead[] }>[];
}
export type CoreApplicationInvocationResult =
  | Readonly<{ kind: "query"; value: DocumentValue; evaluation: CoreApplicationEvaluation }>
  | Readonly<{ kind: "mutation"; value: DocumentValue; disposition: "published" | "replayed"; publishedTimestamp: bigint }>;
const responseHeader = { format: Schema.Literal("flarex.core-application.response"), version: Schema.Literal(1),
  requestKey: TransactionRequestKeyV1Schema, functionPath: TransactionFunctionPathV1Schema, route: Route, value: JsonValue };
const ResponseWire = Schema.Union([
  Schema.Struct({ ...responseHeader, kind: Schema.Literal("query"), evaluation: Evaluation }).annotate(strict),
  Schema.Struct({ ...responseHeader, kind: Schema.Literal("mutation"), disposition: Schema.Literals(["published", "replayed"]),
    publishedTimestamp: Timestamp }).annotate(strict),
]);
export type CoreApplicationInvocationSuccess = CoreApplicationInvocationResult & Readonly<{
  format: "flarex.core-application.response"; version: 1;
  requestKey: typeof TransactionRequestKeyV1Schema.Type;
  functionPath: typeof TransactionFunctionPathV1Schema.Type;
  route: CoreApplicationRouteIdentity;
}>;
const Failure = Schema.Struct({ format: Schema.Literal("flarex.core-application.failure"), version: Schema.Literal(1),
  error: Schema.Struct({ code: Text, message: Text }).annotate(strict) }).annotate(strict);
export type CoreApplicationFailure = typeof Failure.Type;
const decodeRequestWire = Schema.decodeUnknownResult(RequestWire);
const decodeResponseWire = Schema.decodeUnknownResult(ResponseWire);
const decodeRegistrationWire = Schema.decodeUnknownResult(RegistrationWire);
const decodeProfileWire = Schema.decodeUnknownResult(Profile);
const decodeFailureWire = Schema.decodeUnknownResult(Failure);

export class CoreApplicationProtocolError extends Data.TaggedError("CoreApplicationProtocolError")<{
  readonly reason: "invalidRequest" | "invalidResponse" | "invalidValue";
  readonly cause?: unknown;
}> {}
const invalid = (reason: CoreApplicationProtocolError["reason"], cause?: unknown) => new CoreApplicationProtocolError({ reason, cause });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const decodeJson = Schema.decodeUnknownResult(JsonValue);

/** The selected document codec owns bigint, binary, special floats and ID values. */
export function coreApplicationValueToJson(value: unknown): Result.Result<Json, CoreApplicationProtocolError> {
  return Result.gen(function* () {
    const bytes = yield* Result.mapError(encodeDocumentValue(value), cause => invalid("invalidValue", cause));
    const json: unknown = JSON.parse(decoder.decode(bytes));
    return yield* Result.mapError(decodeJson(json), cause => invalid("invalidValue", cause));
  });
}
export function coreApplicationValueFromJson(value: unknown): Result.Result<DocumentValue, CoreApplicationProtocolError> {
  return Result.gen(function* () {
    const json = yield* Result.mapError(decodeJson(value), cause => invalid("invalidValue", cause));
    return yield* Result.mapError(decodeDocumentValue(encoder.encode(JSON.stringify(json))), cause => invalid("invalidValue", cause));
  });
}
export function coreApplicationArgumentsFromJson(value: unknown): Result.Result<DocumentObject, CoreApplicationProtocolError> {
  return Result.flatMap(coreApplicationValueFromJson(value), decoded =>
    Result.mapError(captureDocumentObject(decoded), cause => invalid("invalidValue", cause)));
}
export function decodeCoreApplicationInvocationRequest(value: unknown): Result.Result<CoreApplicationInvocationRequest, CoreApplicationProtocolError> {
  return Result.gen(function* () {
    const wire = yield* Result.mapError(decodeRequestWire(value), cause => invalid("invalidRequest", cause));
    const args = yield* coreApplicationArgumentsFromJson(wire.args);
    return Object.freeze({ ...wire, args });
  });
}
export function encodeCoreApplicationInvocationRequest(value: CoreApplicationInvocationRequest) {
  return Result.flatMap(coreApplicationValueToJson(value.args), args =>
    Result.mapError(decodeRequestWire({ ...value, args }), cause => invalid("invalidRequest", cause)));
}
export const decodeCoreApplicationRegistrationRequest = (value: unknown) =>
  Result.mapError(decodeRegistrationWire(value), cause => invalid("invalidRequest", cause));
export const encodeCoreApplicationRegistrationRequest = decodeCoreApplicationRegistrationRequest;
export const decodeCoreApplicationProfile = (value: unknown) =>
  Result.mapError(decodeProfileWire(value), cause => invalid("invalidResponse", cause));
export const encodeCoreApplicationProfile = decodeCoreApplicationProfile;
export const decodeCoreApplicationFailure = (value: unknown) =>
  Result.mapError(decodeFailureWire(value), cause => invalid("invalidResponse", cause));

function readSetFromWire(reads: readonly typeof Read.Type[]): Result.Result<readonly CoreApplicationIndexRead[], CoreApplicationProtocolError> {
  return Result.all(reads.map(read => Result.gen(function* () {
    const indexId = yield* Result.mapError(Encoding.decodeHex(read.indexId), cause => invalid("invalidResponse", cause));
    const intervals = yield* Result.all(read.intervals.map(interval => Result.gen(function* () {
      const start = interval.start === null ? null : yield* Result.mapError(Encoding.decodeHex(interval.start), cause => invalid("invalidResponse", cause));
      const end = interval.end === null ? null : yield* Result.mapError(Encoding.decodeHex(interval.end), cause => invalid("invalidResponse", cause));
      return Object.freeze({ start, end });
    })));
    return Object.freeze({ indexId, intervals: Object.freeze(intervals) });
  })));
}
const readSetToWire = (reads: readonly CoreApplicationIndexRead[]) => reads.map(read => ({
  indexId: Encoding.encodeHex(read.indexId), intervals: read.intervals.map(interval => ({
    start: interval.start === null ? null : Encoding.encodeHex(interval.start),
    end: interval.end === null ? null : Encoding.encodeHex(interval.end),
  })),
}));
function evaluationFromWire(value: typeof Evaluation.Type): Result.Result<CoreApplicationEvaluation, CoreApplicationProtocolError> {
  return Result.gen(function* () {
    const reads = yield* readSetFromWire(value.reads);
    const metadataReadFrontiers = value.metadataReadFrontiers === undefined ? undefined
      : yield* Result.all(value.metadataReadFrontiers.map(frontier => Result.map(readSetFromWire(frontier.reads), frontierReads =>
        Object.freeze({ timestamp: BigInt(frontier.timestamp), reads: frontierReads }))));
    return Object.freeze({ timestamp: BigInt(value.timestamp), reads,
      ...(metadataReadFrontiers === undefined ? {} : { metadataReadFrontiers: Object.freeze(metadataReadFrontiers) }) });
  });
}
export function encodeCoreApplicationInvocationSuccess(value: CoreApplicationInvocationSuccess) {
  return Result.gen(function* () {
    const json = yield* coreApplicationValueToJson(value.value);
    const wire = value.kind === "mutation" ? { ...value, value: json, publishedTimestamp: value.publishedTimestamp.toString() }
      : { ...value, value: json, evaluation: { timestamp: value.evaluation.timestamp.toString(), reads: readSetToWire(value.evaluation.reads),
        ...(value.evaluation.metadataReadFrontiers === undefined ? {} : { metadataReadFrontiers: value.evaluation.metadataReadFrontiers.map(frontier =>
          ({ timestamp: frontier.timestamp.toString(), reads: readSetToWire(frontier.reads) })) }) } };
    return yield* Result.mapError(decodeResponseWire(wire), cause => invalid("invalidResponse", cause));
  });
}
export function decodeCoreApplicationInvocationSuccess(value: unknown): Result.Result<CoreApplicationInvocationSuccess, CoreApplicationProtocolError> {
  return Result.gen(function* () {
    const wire = yield* Result.mapError(decodeResponseWire(value), cause => invalid("invalidResponse", cause));
    const decoded = yield* coreApplicationValueFromJson(wire.value);
    if (wire.kind === "mutation") return Object.freeze({ ...wire, value: decoded, publishedTimestamp: BigInt(wire.publishedTimestamp) });
    return Object.freeze({ ...wire, value: decoded, evaluation: yield* evaluationFromWire(wire.evaluation) });
  });
}
export const coreApplicationInvocationPath = (deploymentId: string) => `/applications/${encodeURIComponent(deploymentId)}/invoke`;
export const coreApplicationRegistrationPath = (deploymentId: string) => `/applications/${encodeURIComponent(deploymentId)}/register`;
export const coreApplicationProfilePath = (deploymentId: string) => `/applications/${encodeURIComponent(deploymentId)}/profile`;
