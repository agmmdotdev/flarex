import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Cause, Clock, Data, Effect, Exit, Result } from "effect";
import {
  captureDocumentValueWithSize,
  type DocumentObject,
  type DocumentValue,
} from "flarex-protocol/document-value";
import {
  inspectVerifiedApplicationMutationGrantV1,
  type PrepareApplicationMutationGrantV1Input,
  type VerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import {
  canonicalizePointMutationRequestV1,
  requirePointMutationArgumentSemanticSizeV1,
} from "flarex-protocol/point-mutation-start";
import {
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  type CanonicalTransactionGrantIdentityAccessPolicyV1,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionArgumentsSha256V1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueJsonV1, FlarexValueCodecVersionSchema, isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";
import { canonicalFlarexRuntimeValueToJsonV1 } from "flarex-protocol/internal/value-runtime-core";

import {
  CoreTransactionError,
  type CoreDatabase,
  type CoreProgramDefinition,
  type CoreError,
  type CoreRequestClaim,
  type CoreTransaction,
} from "../core/api";
import { CorePersistenceError } from "../core/contracts";
import { readCoreApplicationProgram, readCoreApplicationTableBindings, validateCoreApplicationArguments,
  captureCoreApplicationProgramProfile, requireCoreApplicationProgramProfile, type CoreApplicationProgramProfile,
  type CoreApplicationProgram as SharedCoreApplicationProgram, type CoreApplicationTableBinding } from "./coreProgram";

/** Application policy above the shared engine, never a second publisher. */
export class CoreApplicationMutationError extends Data.TaggedError("CoreApplicationMutationError")<{
  readonly reason: "metadataInvalid" | "argumentsInvalid" | "hashFailure" | "revoked"
    | "expired" | "inProgress" | "terminalRequest" | "internalFunction" | "unsupportedSelection";
  readonly cause?: unknown;
}> {}

export type CoreApplicationProgram = Extract<SharedCoreApplicationProgram, { kind: "mutation" }>;
export type { CoreApplicationTableBinding } from "./coreProgram";
export interface CoreApplicationMutationOutcome {
  readonly disposition: "published" | "replayed";
  readonly timestamp: bigint;
  readonly value: DocumentValue;
  readonly scopeUuid: string;
  readonly epochUuid: string;
}

type GrantInput = Omit<PrepareApplicationMutationGrantV1Input, "kid" | "grantId" | "issuedAt" | "expiresAt">;

export interface CoreApplicationMutationConfiguration<GrantFailure, ExecutionFailure> {
  readonly database: CoreDatabase;
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly expectedProgramProfile?: CoreApplicationProgramProfile;
  /** Explicit admission budget; no automatic replay is granted to native adapters. */
  readonly maximumAttempts: number;
  readonly issueGrant: (input: GrantInput) => Effect.Effect<VerifiedApplicationMutationGrantV1, GrantFailure>;
  readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, unknown>;
  readonly execute: (input: Readonly<{
    program: CoreApplicationProgram;
    transaction: CoreTransaction;
    grant: VerifiedApplicationMutationGrantV1;
    arguments: DocumentObject;
    argumentSemanticBytes: number;
    tables: readonly CoreApplicationTableBinding[];
    /** Existing grant/credential duties, kept separate from snapshot data. */
    revalidate: Effect.Effect<void, CoreError | CoreApplicationMutationError>;
  }>) => Effect.Effect<DocumentValue, ExecutionFailure>;
}

export function makeCoreApplicationMutationPort<GrantFailure, ExecutionFailure>(
  configuration: CoreApplicationMutationConfiguration<GrantFailure, ExecutionFailure>,
) {
  const database = configuration.database;
  const expectedProgramProfile = configuration.expectedProgramProfile === undefined ? undefined
    : captureCoreApplicationProgramProfile(configuration.expectedProgramProfile);
  const maximumAttempts = configuration.maximumAttempts;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1)
    throw new Error("Application mutation attempt budget must be a positive integer.");

  const readProgram = Effect.fn("CoreApplicationMutation.readProgram")(function* (
    definition: CoreProgramDefinition, historicalRequest: boolean,
  ) {
    const program = yield* readCoreApplicationProgram(definition, configuration.sha256).pipe(Effect.mapError(cause =>
      new CoreApplicationMutationError({ reason: cause.reason, cause })));
    if (expectedProgramProfile !== undefined) {
      const expected = yield* Effect.fromResult(expectedProgramProfile).pipe(Effect.mapError(cause =>
        new CoreApplicationMutationError({ reason: cause.reason, cause })));
      // Exact durable correlation supplies the historical source authority.
      // Scope and epoch routing pins still confine its result to this host.
      const profile = historicalRequest ? { ...expected,
        sourceArtifactRootSha256: program.runtimeTarget.sourceArtifactRootSha256 } : expected;
      yield* Effect.fromResult(requireCoreApplicationProgramProfile(program, profile)).pipe(
        Effect.mapError(cause => new CoreApplicationMutationError({ reason: cause.reason, cause })));
    }
    return program;
  });
  const requireAuthority = Effect.fn("CoreApplicationMutation.requireAuthority")(
    function* (grant: VerifiedApplicationMutationGrantV1) {
      const payload = inspectVerifiedApplicationMutationGrantV1(grant).payload;
      const epoch = yield* database.readAuthorityEpoch;
      if (epoch !== payload.authorizationRevocationEpoch)
        return yield* new CoreApplicationMutationError({ reason: "revoked" });
      if ((yield* Clock.currentTimeMillis) >= Date.parse(payload.expiresAt))
        return yield* new CoreApplicationMutationError({ reason: "expired" });
    },
  );

  const abortWithCause = <Failure>(claim: CoreRequestClaim, cause: Cause.Cause<Failure>) =>
    database.abortRequest(claim).pipe(Effect.exit, Effect.flatMap(aborted =>
      Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));

  const dispatch = Effect.fn("CoreApplicationMutation.dispatch")(function* (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
    identityAccessPolicy: CanonicalTransactionGrantIdentityAccessPolicyV1,
    selection: "mutation" | "infer",
  ) {
    // Correlation does not depend on the current catalogue: an authenticated
    // committed request survives removal and changes to kind or validators.
    const captured = yield* Effect.fromResult(captureDocumentValueWithSize(args)).pipe(
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: "argumentsInvalid", cause })),
    );
    if (!isCanonicalFlarexRuntimeObjectV1(captured.value))
      return yield* new CoreApplicationMutationError({ reason: "argumentsInvalid" });
    const argumentsValue = captured.value;
    yield* Effect.try({ try: () => requirePointMutationArgumentSemanticSizeV1(captured.semanticSizeBytes),
      catch: cause => new CoreApplicationMutationError({ reason: "argumentsInvalid", cause }) });
    const canonical = yield* Effect.tryPromise({ try: () => canonicalizeFlarexValueJsonV1(
      canonicalFlarexRuntimeValueToJsonV1(argumentsValue)),
      catch: cause => new CoreApplicationMutationError({ reason: "hashFailure", cause }) });
    const request = yield* Effect.tryPromise({ try: () => canonicalizePointMutationRequestV1({
      deploymentId: configuration.deploymentId, functionPath,
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(new Uint8Array(canonical.sha256)), requestKey,
    }), catch: cause => new CoreApplicationMutationError({ reason: "hashFailure", cause }) });
    const correlation: Json = { requestSha256: encodeBytesToLowercaseHex(request.sha256),
      identityAccessPolicySha256: identityAccessPolicy.sha256Hex, functionPath };
    const requestHash = yield* configuration.sha256(new TextEncoder().encode(encodeCanonicalJson(correlation,
      issue => { throw new Error(`Application request correlation invariant: ${issue.reason}`); }))).pipe(
      Effect.map(encodeBytesToLowercaseHex),
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: "hashFailure", cause })),
    );
    const original = yield* database.resolveApplicationRequest({ key: requestKey, requestHash, functionPath });
    const program = yield* readProgram(original.kind === "missing"
      ? yield* database.selectProgram(functionPath) : original.program, original.kind !== "missing");
    const target = program.runtimeTarget;
    if (selection === "mutation" && program.kind !== "mutation")
      return yield* new CoreApplicationMutationError({ reason: "unsupportedSelection" });
    if (target.function.visibility !== "public")
      return yield* new CoreApplicationMutationError({ reason: "internalFunction" });
    if (program.kind !== "mutation") {
      // This marker carries no execution authority. The query owner selects
      // its coherent snapshot and validates arguments under the exact source.
      if (selection === "infer" && original.kind === "missing") return Object.freeze({ kind: "query" as const });
      return yield* new CoreApplicationMutationError({ reason: "unsupportedSelection" });
    }
    if (original.kind === "missing") {
      const admission = yield* database.begin({ program: program.definition.identity });
      const tables = yield* readTableBindings(admission).pipe(Effect.ensuring(admission.abort()));
      yield* Effect.fromResult(validateArguments(target.function.args, argumentsValue, tables));
    }
    const grant = yield* configuration.issueGrant({ deploymentId: configuration.deploymentId,
      executionAuthority: program.executionAuthority, policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicy, validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1),
      validatedArgsSha256: encodeBytesToLowercaseHex(canonical.sha256), requestKey,
      requestSha256: encodeBytesToLowercaseHex(request.sha256),
      authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(yield* database.readAuthorityEpoch),
    });
    yield* requireAuthority(grant);
    const identity = Object.freeze({ key: requestKey, requestHash, program: program.definition.identity });
    const admissionPin = original.kind !== "missing" || expectedProgramProfile === undefined ? undefined
      : yield* Effect.fromResult(expectedProgramProfile).pipe(
        Effect.mapError(cause => new CoreApplicationMutationError({ reason: cause.reason, cause })),
        Effect.map(profile => profile.sourcePackageHash === undefined ? undefined : {
          sourceArtifactRootSha256: profile.sourceArtifactRootSha256, sourcePackageHash: profile.sourcePackageHash,
        }),
      );
    const outcome = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const observed = original.kind === "missing" ? yield* (admissionPin === undefined
      ? database.claimRequest(identity) : database.claimApplicationRequest(identity, admissionPin)) : original;
    if (observed.kind === "busy") yield* requireAuthority(grant);
    // Explicit recovery only reconciles an already authenticated existing
    // claim. A missing outcome never grants another body implicitly.
    const acquisition = observed.kind === "busy" ? yield* database.recoverRequest(identity) : observed;
    if (acquisition.kind === "missing") return yield* new CorePersistenceError({ reason: "corruptData" });
    if (acquisition.kind === "busy" || acquisition.kind === "failed") {
      yield* requireAuthority(grant);
      return yield* new CoreApplicationMutationError({ reason: acquisition.kind === "busy" ? "inProgress" : "terminalRequest" });
    }
    if (acquisition.kind === "committed") {
      yield* requireAuthority(grant);
      return Object.freeze({ disposition: "replayed" as const,
        timestamp: acquisition.timestamp, value: acquisition.result, scopeUuid: program.scopeUuid, epochUuid: program.epochUuid });
    }
    const claim = acquisition.claim;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const body = Effect.gen(function* () {
        yield* requireAuthority(grant);
        yield* database.lookupProgram(program.definition.identity);
        const transaction = yield* database.begin({ program: program.definition.identity, claim,
          authorityEpoch: inspectVerifiedApplicationMutationGrantV1(grant).payload.authorizationRevocationEpoch });
        return yield* Effect.gen(function* () {
          const bodyTables = yield* readTableBindings(transaction);
          yield* Effect.fromResult(validateArguments(target.function.args, argumentsValue, bodyTables));
          const value = yield* configuration.execute({ program, transaction, grant,
            arguments: argumentsValue, argumentSemanticBytes: captured.semanticSizeBytes,
            tables: bodyTables,
            revalidate: requireAuthority(grant) });
          yield* requireAuthority(grant);
          return { value, finalized: yield* transaction.finalize() };
        }).pipe(Effect.ensuring(transaction.abort()));
      });
      const bodyExit = yield* Effect.exit(restore(body));
      if (Exit.isFailure(bodyExit)) return yield* abortWithCause(claim, bodyExit.cause);
      const committed = yield* Effect.exit(database.commit(bodyExit.value.finalized, { claim, result: bodyExit.value.value,
        admissionDeadlineUnixMilliseconds: Date.parse(inspectVerifiedApplicationMutationGrantV1(grant).payload.expiresAt),
      }));
      if (Exit.isSuccess(committed)) {
        yield* requireAuthority(grant);
        return Object.freeze({ disposition: "published" as const,
          timestamp: committed.value, value: bodyExit.value.value, scopeUuid: program.scopeUuid, epochUuid: program.epochUuid });
      }
      const reason = committed.cause.reasons.length === 1 ? committed.cause.reasons[0] : undefined;
      if (reason !== undefined && Cause.isFailReason(reason) &&
        reason.error instanceof CoreTransactionError && reason.error.reason === "conflict" && attempt < maximumAttempts) continue;
      // A persistence failure can be uncertain. Its owner must reconcile it;
      // never turn it into a fresh body by releasing the durable claim here.
      if (reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreTransactionError) {
        const cause = reason.error.reason === "admissionExpired" ? Cause.map(committed.cause, error =>
          error instanceof CoreTransactionError && error.reason === "admissionExpired"
            ? new CoreApplicationMutationError({ reason: "expired", cause: error }) : error) : committed.cause;
        return yield* abortWithCause(claim, cause);
      }
      return yield* Effect.failCause(committed.cause);
    }
    return yield* Effect.die(new Error("Application mutation attempt loop did not terminate."));
    }));
    return Object.freeze({ kind: "mutation" as const, outcome });
  });
  const invoke = Effect.fn("CoreApplicationMutation.invoke")(function* (
    functionPath: TransactionFunctionPathV1, args: unknown, requestKey: TransactionRequestKeyV1,
    identityAccessPolicy: CanonicalTransactionGrantIdentityAccessPolicyV1,
  ) {
    const selected = yield* dispatch(functionPath, args, requestKey, identityAccessPolicy, "mutation");
    if (selected.kind === "query") return yield* Effect.die(new Error("Explicit mutation admission returned a query marker."));
    return selected.outcome;
  });
  const infer = Effect.fn("CoreApplicationMutation.infer")((...input: Parameters<typeof invoke>) => dispatch(...input, "infer"));
  return Object.freeze({ invoke, infer });
}

export type CoreApplicationMutationPort<GrantFailure, ExecutionFailure> = ReturnType<
  typeof makeCoreApplicationMutationPort<GrantFailure, ExecutionFailure>
>;

export type CoreApplicationMutationFailure<GrantFailure, ExecutionFailure> =
  CoreError | CoreApplicationMutationError | GrantFailure | ExecutionFailure;

const readTableBindings = readCoreApplicationTableBindings;
const validateArguments = (...input: Parameters<typeof validateCoreApplicationArguments>) =>
  validateCoreApplicationArguments(...input).pipe(Result.mapError(cause =>
    new CoreApplicationMutationError({ reason: cause.reason, cause })));
