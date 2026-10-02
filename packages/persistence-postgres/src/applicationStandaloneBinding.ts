import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { Data, Effect, Schema } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

const identity = Schema.NonEmptyString;
const digest = Schema.String.check(Schema.makeFilter(value => /^[a-f0-9]{64}$/.test(value)
  ? undefined : "Expected a lowercase SHA-256 digest"));
const sequence = Schema.String.check(Schema.makeFilter(value => /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) <= 9_223_372_036_854_775_807n ? undefined : "Expected a bounded sequence"));
const positiveSequence = sequence.check(Schema.makeFilter(value => value !== "0" ? undefined : "Expected a positive sequence"));
const legacy = Schema.Struct({ kind: Schema.Literal("legacy"), schemaBindingSha256: digest });
const relationFields = {
  manifestSchemaBindingSha256: digest, boundPublicationSha256: digest,
  relationFrontierCommitSeq: sequence, relationSetReadinessSha256: digest,
  relationCount: Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0 && value <= 1024
    ? undefined : "Expected a bounded relation count")),
};
const relation = Schema.Struct({ kind: Schema.Literal("relation"), ...relationFields })
  .check(Schema.makeFilter(value => value.relationCount >= 1 ? undefined : "Expected at least one relation"));
const policy = Schema.Struct({ kind: Schema.Literal("policy"), ...relationFields,
  writePolicySetSha256: digest, writeOwnershipSha256: digest });

/** Activation publishes only immutable correlation, never an access verdict.
 * The target installation protects this bounded append-only projection. */
export const StandaloneApplicationBindingSchema = Schema.Struct({
  format: Schema.Literal("flarex.application.read-binding"),
  deploymentId: identity, scopeId: identity,
  storageGeneration: Schema.Literal("flarexdb_v1"), storageGenerationFence: positiveSequence, epoch: identity,
  activationSequence: positiveSequence, headSha256: digest, activationSha256: digest,
  revisionId: identity, schemaVersionId: identity, applicationSchemaSha256: digest,
  schemaManifestSha256: digest, readinessSha256: digest,
  readiness: Schema.Union([legacy, relation, policy]),
  analysis: Schema.Struct({ candidateId: identity, analysisId: identity,
    manifestSha256: digest, sourceArtifactRootSha256: digest }),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type StandaloneApplicationBinding = typeof StandaloneApplicationBindingSchema.Type;
const decode = Schema.decodeUnknownEffect(StandaloneApplicationBindingSchema);
const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
export const MAX_STANDALONE_APPLICATION_BINDING_BYTES = 16_384;

export class StandaloneApplicationBindingError extends Data.TaggedError("StandaloneApplicationBindingError")<{
  readonly reason: "storedState" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: StandaloneApplicationBindingError["reason"], cause?: unknown) =>
  new StandaloneApplicationBindingError({ reason, ...(cause === undefined ? {} : { cause }) });
const digestBytes = makeLivePrivateSha256V1({
  invalidBudget: () => failure("storedState"), invalidBytes: () => failure("storedState"),
  inputBytesExceeded: () => failure("storedState"), unavailable: () => failure("resourceFailure"),
  nativeRejected: cause => failure("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid Application read-binding SHA-256 output"),
});

export const canonicalStandaloneApplicationBinding = Effect.fn("ApplicationReadBinding.canonical")(
  function* (input: unknown) {
    const frame = yield* decode(input).pipe(Effect.mapError(cause => failure("storedState", cause)));
    const text = encodeCanonicalJson(frame satisfies Json, cause => { throw cause; });
    const bytes = utf8.encode(text);
    if (bytes.byteLength > MAX_STANDALONE_APPLICATION_BINDING_BYTES)
      return yield* Effect.fail(failure("storedState"));
    const sha256 = yield* digestBytes(bytes, { maximumInputBytes: MAX_STANDALONE_APPLICATION_BINDING_BYTES });
    return { frame, bytes, sha256 };
  },
);

/** The canonical codec authenticates detached bytes and their exact row roots.
 * Admission and installation authenticity remain with their nominal owners. */
export const decodeStandaloneApplicationBinding = Effect.fn("ApplicationReadBinding.decode")(
  function* (row: { readonly bindingBytes: Uint8Array; readonly bindingSha256: Uint8Array;
    readonly scopeId: string; readonly activationSequence: bigint; readonly revisionId: string;
    readonly activationSha256: Uint8Array; readonly readinessSha256: Uint8Array;
    readonly readinessContractVersion: 1 | 2 | 3 }) {
    if (row.bindingBytes.byteLength < 1 || row.bindingBytes.byteLength > MAX_STANDALONE_APPLICATION_BINDING_BYTES)
      return yield* Effect.fail(failure("storedState"));
    const input = yield* Effect.try({ try: (): unknown => JSON.parse(utf8Fatal.decode(row.bindingBytes)),
      catch: cause => failure("storedState", cause) });
    const canonical = yield* canonicalStandaloneApplicationBinding(input);
    const frame = canonical.frame;
    if (!bytesEqualFullScan(canonical.bytes, row.bindingBytes) || !bytesEqualFullScan(canonical.sha256, row.bindingSha256) ||
      frame.scopeId !== row.scopeId || frame.activationSequence !== row.activationSequence.toString() ||
      frame.revisionId !== row.revisionId || frame.activationSha256 !== encodeBytesToLowercaseHex(row.activationSha256) ||
      row.readinessContractVersion !== (frame.readiness.kind === "legacy" ? 1 : frame.readiness.kind === "relation" ? 2 : 3) ||
      frame.readinessSha256 !== encodeBytesToLowercaseHex(row.readinessSha256))
      return yield* Effect.fail(failure("storedState"));
    return frame;
  },
);
