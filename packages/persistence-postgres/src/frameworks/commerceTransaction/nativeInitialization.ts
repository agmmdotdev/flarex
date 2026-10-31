import { Cause, Effect, Schema, type Result } from "effect";
import type { CoreDatabase, CoreNativeBinding, CoreNativeBindingMetadata, CoreRequestIdentity, CoreError } from "../../core/api";
import { CoreTransactionError } from "../../core/api";
import { sameCoreNativeIdentity } from "../../core/nativePolicy";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { decodeCommerceInitialization, type CommerceInitialization } from "./initializationContract";
import { commerceError, commerceLimits, type CommerceTransactionError } from "./model";
import { projectCoreCommerceFailure } from "./nativeFailure";

/** An actual private host callback owns this command; it is not a public service method. */
export const commerceNativeInitializationCommand = Object.freeze({ name: "commerce-initialize", mode: "write" as const });
const InitializationResult = Schema.Struct({ rowCount: Schema.Int }).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeResult = Schema.decodeUnknownEffect(InitializationResult);
export interface NativeCommerceInitialization {
  readonly descriptor: CommerceInitialization;
  readonly identity: CoreRequestIdentity;
  readonly requireReady: Effect.Effect<void, CommerceTransactionError>;
  readonly readBinding: () => Effect.Effect<CoreNativeBindingMetadata, CommerceTransactionError>;
  readonly result: (value: unknown) => Effect.Effect<typeof InitializationResult.Type, CommerceTransactionError>;
  readonly verifyRows: (rows: unknown) => Effect.Effect<Result.Result.Success<ReturnType<typeof capturePrivateJsonData<CommerceTransactionError>>>, CommerceTransactionError>;
  readonly projectLookup: <Value>(work: Effect.Effect<Value, CoreError>) => Effect.Effect<Value, CommerceTransactionError>;
}
const digest = <Frame extends Parameters<typeof capturePrivateCanonicalValue>[0]>(frame: Frame) =>
  capturePrivateCanonicalValue(frame, commerceLimits.commandBytes,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
const projectLookup = <Value>(work: Effect.Effect<Value, CoreError>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure => failure instanceof CoreTransactionError
    && failure.reason === "requestMismatch" ? commerceError("seedMismatch", failure) : projectCoreCommerceFailure(failure)))));

/** One stable receipt is the Core outcome of the same atomic initialization.
 * It grants neither row access nor command execution. */
export const makeNativeCommerceInitialization = Effect.fn("NativeCommerce.prepareInitialization")(function* (
  database: CoreDatabase, binding: CoreNativeBinding, input: CommerceInitialization,
): Effect.fn.Return<NativeCommerceInitialization, CommerceTransactionError> {
  const descriptorCapture = yield* Effect.fromResult(capturePrivateJsonData(input, 4096, commerceError));
  const descriptor = yield* Effect.fromResult(decodeCommerceInitialization(descriptorCapture.value))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const metadata = yield* database.readNativeBinding(binding).pipe(Effect.mapError(projectCoreCommerceFailure));
  const source = metadata.definition.identity;
  const key = `commerce/init/${(yield* digest({ format: "flarex.native-initialization-key", version: 1,
    scopeUuid: source.scopeUuid, epochUuid: source.epochUuid, sourceKey: source.sourceKey, stepId: descriptor.stepId })).sha256Hex}`;
  const requestHash = (yield* digest({ format: "flarex.native-initialization", version: 1,
    source: { ...source }, initialization: { ...descriptor } })).sha256Hex;
  const identity: CoreRequestIdentity = Object.freeze({ kind: "native", key, requestHash,
    native: Object.freeze({ source, ...commerceNativeInitializationCommand }) });
  const readBinding = Effect.fn("NativeCommerce.initializationBinding")(function* () {
    const current = yield* database.readNativeBinding(binding).pipe(Effect.mapError(projectCoreCommerceFailure));
    if (!sameCoreNativeIdentity(current.definition.identity, source)) return yield* commerceError("seedMismatch");
    return current;
  });
  const result = (inputResult: unknown) => decodeResult(inputResult).pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)),
    Effect.flatMap(value => value.rowCount === descriptor.expectedRowCount ? Effect.succeed(value)
      : Effect.fail(commerceError("storedCorruption"))));
  const requireReady = Effect.fn("NativeCommerce.requireInitialization")(function* () {
    yield* readBinding();
    const observed = yield* projectLookup(database.resolveRequest(identity));
    const resolved = observed.kind === "busy" ? yield* projectLookup(database.recoverRequest(identity)) : observed;
    if (resolved.kind !== "committed") return yield* commerceError("seedRequired");
    yield* result(resolved.result);
    yield* readBinding();
  });
  const verifyRows = Effect.fn("NativeCommerce.verifyInitializationRows")(function* (rows: unknown) {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(rows, commerceLimits.commandBytes, commerceError));
    if (!Array.isArray(captured.value) || captured.value.length !== descriptor.expectedRowCount)
      return yield* commerceError("seedMismatch");
    const dataset = yield* digest({ format: "flarex.initialization-dataset", version: 1, rows: captured.value });
    if (dataset.sha256Hex !== descriptor.datasetSha256) return yield* commerceError("seedMismatch");
    return captured;
  });
  return Object.freeze({ descriptor, identity, requireReady: requireReady(), readBinding, result, verifyRows, projectLookup });
});
