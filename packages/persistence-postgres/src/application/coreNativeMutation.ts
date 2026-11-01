import { Cause, Clock, Effect, Exit, type Scope } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { captureDocumentValueWithSize, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { canonicalizePointMutationRequestV1, requirePointMutationArgumentSemanticSizeV1 } from "flarex-protocol/point-mutation-start";
import { canonicalizeFlarexValueJsonV1, FlarexValueCodecVersionSchema, isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";
import { canonicalFlarexRuntimeValueToJsonV1 } from "flarex-protocol/internal/value-runtime-core";
import { inspectVerifiedApplicationMutationGrantV1, type VerifiedApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import { TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, type CanonicalTransactionGrantIdentityAccessPolicyV1,
  type TransactionGrantDeploymentIdV1, type TransactionGrantIdentityAccessPolicySha256HexV1 } from "flarex-protocol/transaction-grant";
import { TransactionArgumentsSha256V1Schema, TransactionAuthorizationRevocationEpochSchema,
  type TransactionFunctionPathV1, type TransactionRequestKeyV1 } from "flarex-protocol/transaction-session";
import { CoreTransactionError, isCoreDefinitiveCommitRefusal, type CoreDatabase, type CoreError, type CoreNativeRootBinding,
  type CoreNativeRootBindingMetadata, type CoreNativeRootOperation, type CoreNativeRootRecoveryInput, type CoreProgramIdentity,
  type CoreRequestClaim } from "../core/api";
import { programKey } from "../core/registry";
import { readCoreApplicationProgram, validateCoreApplicationArguments, type CoreApplicationTableBinding } from "./coreProgram";
import { CoreApplicationMutationError, type CoreApplicationMutationConfiguration, type CoreApplicationMutationOutcome,
  type CoreApplicationProgram } from "./coreMutation";

interface NativeExecutionInput {
  readonly program: CoreApplicationProgram;
  readonly grant: VerifiedApplicationMutationGrantV1;
  readonly arguments: DocumentObject;
  readonly argumentSemanticBytes: number;
  readonly tables: readonly CoreApplicationTableBinding[];
  readonly revalidate: Effect.Effect<void, CoreError | CoreApplicationMutationError>;
}
export interface CoreNativeApplicationMutationConfiguration<GrantFailure, ExecutionFailure> {
  readonly database: CoreDatabase;
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  /** Authenticated immutable historical profile; it carries no live grant. */
  readonly program: CoreProgramIdentity;
  readonly root: CoreNativeRootRecoveryInput;
  /** This private profile was prepared for this captured canonical principal. */
  readonly identityAccessPolicySha256: TransactionGrantIdentityAccessPolicySha256HexV1;
  readonly issueGrant: CoreApplicationMutationConfiguration<GrantFailure, ExecutionFailure>["issueGrant"];
  readonly sha256: CoreApplicationMutationConfiguration<GrantFailure, ExecutionFailure>["sha256"];
  /** Opens the current native profile only after genuinely absent outcome and
   * normal current Application admission. The scope owns/drains native/Worker resources. */
  readonly open: (input: NativeExecutionInput) => Effect.Effect<Readonly<{
    binding: CoreNativeRootBinding;
    chargeRetained: (bytes: number) => Effect.Effect<void, CoreError>;
    seal: Effect.Effect<void, CoreError | ExecutionFailure>;
    admissionDeadlineUnixMilliseconds: number;
    execute: (input: NativeExecutionInput & Readonly<{ operation: CoreNativeRootOperation; root: CoreNativeRootBindingMetadata }>) =>
      Effect.Effect<DocumentValue, ExecutionFailure>;
  }>, CoreError | ExecutionFailure, Scope.Scope>;
}

/** Native mixed profile policy over the existing Core request/outcome owner.
 * There is one logical root and no automatic Worker/native body replay. */
export function makeCoreNativeApplicationMutationPort<GrantFailure, ExecutionFailure>(
  configuration: CoreNativeApplicationMutationConfiguration<GrantFailure, ExecutionFailure>,
) {
  const { database, identityAccessPolicySha256 } = configuration;
  const abortWithCause = <Failure>(claim: CoreRequestClaim, cause: Cause.Cause<Failure>) => database.abortRequest(claim).pipe(
    Effect.exit, Effect.flatMap(aborted => Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));
  const invoke = Effect.fn("CoreNativeApplicationMutation.invoke")(function* (
    path: TransactionFunctionPathV1, args: unknown, key: TransactionRequestKeyV1, identityAccessPolicy: CanonicalTransactionGrantIdentityAccessPolicyV1,
  ): Effect.fn.Return<CoreApplicationMutationOutcome, CoreError | CoreApplicationMutationError | GrantFailure | ExecutionFailure> {
    if (identityAccessPolicy.sha256Hex !== identityAccessPolicySha256)
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const program = yield* readCoreApplicationProgram(yield* database.lookupProgram(configuration.program), configuration.sha256)
      .pipe(Effect.mapError(cause => new CoreApplicationMutationError({ reason: cause.reason, cause })));
    const actor = configuration.root.applicationProgram ?? configuration.root.applicationRead?.program;
    if (program.kind !== "mutation" || path !== program.definition.identity.functionPath || actor === undefined
      || programKey(actor) !== programKey(program.definition.identity)
      || configuration.root.applicationProgram !== undefined && configuration.root.applicationRead !== undefined
        && programKey(configuration.root.applicationProgram) !== programKey(configuration.root.applicationRead.program))
      return yield* new CoreApplicationMutationError({ reason: "unsupportedSelection" });
    const captured = yield* Effect.fromResult(captureDocumentValueWithSize(args)).pipe(
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: "argumentsInvalid", cause })));
    if (!isCanonicalFlarexRuntimeObjectV1(captured.value)) return yield* new CoreApplicationMutationError({ reason: "argumentsInvalid" });
    const argumentsValue = captured.value;
    yield* Effect.try({ try: () => requirePointMutationArgumentSemanticSizeV1(captured.semanticSizeBytes),
      catch: cause => new CoreApplicationMutationError({ reason: "argumentsInvalid", cause }) });
    const tableRead = yield* database.begin();
    const mappings = yield* tableRead.tableMappings.pipe(Effect.ensuring(tableRead.abort()));
    const tables = mappings.filter(binding => program.manifest.schema.tables.some(table => table.name === binding.logicalName));
    yield* Effect.fromResult(validateCoreApplicationArguments(program.runtimeTarget.function.args, argumentsValue, tables)).pipe(
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: cause.reason, cause })));
    const canonical = yield* Effect.tryPromise({ try: () => canonicalizeFlarexValueJsonV1(canonicalFlarexRuntimeValueToJsonV1(argumentsValue)),
      catch: cause => new CoreApplicationMutationError({ reason: "hashFailure", cause }) });
    const request = yield* Effect.tryPromise({ try: () => canonicalizePointMutationRequestV1({ deploymentId: configuration.deploymentId,
      functionPath: path, requestKey: key, validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(new Uint8Array(canonical.sha256)) }),
      catch: cause => new CoreApplicationMutationError({ reason: "hashFailure", cause }) });
    const recovery = yield* database.bindNativeRootRecovery(configuration.root);
    const correlation: Json = { requestSha256: encodeBytesToLowercaseHex(request.sha256), identityAccessPolicySha256: identityAccessPolicy.sha256Hex,
      functionPath: path, root: { ...recovery.identity } };
    const requestHash = yield* configuration.sha256(new TextEncoder().encode(encodeCanonicalJson(correlation,
      issue => { throw new Error(`Native Application correlation invariant: ${issue.reason}`); }))).pipe(Effect.map(encodeBytesToLowercaseHex),
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: "hashFailure", cause })));
    const identity = Object.freeze({ kind: "nativeRoot" as const, key, requestHash, root: recovery.identity });
    const observed = yield* recovery.resolve(identity);
    const historical = observed.kind === "busy" ? yield* recovery.recover(identity) : observed;
    const outcome = (timestamp: bigint, value: DocumentValue, disposition: "published" | "replayed"): CoreApplicationMutationOutcome =>
      Object.freeze({ timestamp, value, disposition, scopeUuid: program.scopeUuid, epochUuid: program.epochUuid });
    if (historical.kind === "committed") return outcome(historical.timestamp, historical.result, "replayed");
    if (historical.kind !== "missing" && !(historical.kind === "failed" && configuration.root.retryProvenNoncommit === true))
      return yield* new CoreApplicationMutationError({
      reason: historical.kind === "busy" ? "inProgress" : "terminalRequest" });
    // A new caller invocation may explicitly select proven-noncommit reuse.
    // The existing claim owner proves explicit abort or fenced recovered absence;
    // no body is retried within this invocation, and defaults stay terminal.
    const current = yield* database.selectProgram(path);
    if (programKey(current.identity) !== programKey(program.definition.identity)) return yield* new CoreTransactionError({ reason: "programUnavailable" });
    const grant = yield* configuration.issueGrant({ deploymentId: configuration.deploymentId, executionAuthority: program.executionAuthority,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, identityAccessPolicy,
      validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1), validatedArgsSha256: encodeBytesToLowercaseHex(canonical.sha256),
      requestKey: key, requestSha256: encodeBytesToLowercaseHex(request.sha256),
      authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(yield* database.readAuthorityEpoch) });
    const revalidate = Effect.gen(function* () {
      const payload = inspectVerifiedApplicationMutationGrantV1(grant).payload;
      if ((yield* database.readAuthorityEpoch) !== payload.authorizationRevocationEpoch)
        return yield* new CoreApplicationMutationError({ reason: "revoked" });
      if ((yield* Clock.currentTimeMillis) >= Date.parse(payload.expiresAt)) return yield* new CoreApplicationMutationError({ reason: "expired" });
    });
    yield* revalidate;
    const execution: NativeExecutionInput = { program, grant, arguments: argumentsValue, argumentSemanticBytes: captured.semanticSizeBytes, tables, revalidate };
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      let claim: CoreRequestClaim | undefined;
      const staged = yield* Effect.exit(Effect.scoped(Effect.gen(function* () {
      const prepared = yield* restore(configuration.open(execution));
      yield* prepared.chargeRetained(captured.semanticSizeBytes);
      const metadata = yield* database.readNativeRootBinding(prepared.binding);
      if (metadata.identity.definitionHash !== recovery.identity.definitionHash) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const claimed = yield* database.claimRequest(identity, prepared.binding);
      const acquired = claimed.kind === "busy" ? yield* database.recoverRequest(identity) : claimed;
      if (acquired.kind === "committed") return { kind: "replayed" as const, outcome: outcome(acquired.timestamp, acquired.result, "replayed") };
      if (acquired.kind !== "claimed") return yield* new CoreApplicationMutationError({ reason: acquired.kind === "busy" ? "inProgress" : "terminalRequest" });
      claim = acquired.claim;
      const body = yield* restore(Effect.acquireUseRelease(database.beginNativeRoot(prepared.binding,
        { claim: acquired.claim, chargeRetained: prepared.chargeRetained }), operation => Effect.gen(function* () {
        const executed = yield* Effect.exit(prepared.execute({ ...execution, operation, root: metadata }));
        if (Exit.isFailure(executed)) {
          const sealed = yield* Effect.exit(prepared.seal);
          return yield* Effect.failCause(Exit.isFailure(sealed) ? Cause.combine(executed.cause, sealed.cause) : executed.cause);
        }
        const result = yield* Effect.fromResult(captureDocumentValueWithSize(executed.value)).pipe(Effect.mapError(cause =>
          new CoreTransactionError({ reason: "invalidValue", cause })));
        yield* prepared.chargeRetained(result.semanticSizeBytes);
        yield* revalidate;
        yield* prepared.seal;
        return { value: result.value, finalized: yield* operation.finalize() };
      }), operation => operation.abort()));
      return { kind: "staged" as const, ...body, claim: acquired.claim, deadline: prepared.admissionDeadlineUnixMilliseconds };
      })));
      if (Exit.isFailure(staged)) return claim === undefined ? yield* Effect.failCause(staged.cause) : yield* abortWithCause(claim, staged.cause);
      if (staged.value.kind === "replayed") return staged.value.outcome;
      // Every Worker/native scope is fully drained and disposed before the
      // single trusted durability owner receives the frozen transaction.
      const committed = yield* Effect.exit(database.commit(staged.value.finalized, { claim: staged.value.claim, result: staged.value.value,
        admissionDeadlineUnixMilliseconds: staged.value.deadline }));
      if (Exit.isSuccess(committed)) return outcome(committed.value, staged.value.value, "published");
      const reason = committed.cause.reasons.length === 1 ? committed.cause.reasons[0] : undefined;
      return reason !== undefined && Cause.isFailReason(reason) && isCoreDefinitiveCommitRefusal(reason.error)
        ? yield* abortWithCause(staged.value.claim, committed.cause) : yield* Effect.failCause(committed.cause);
    }));
  });
  return Object.freeze({ invoke });
}
