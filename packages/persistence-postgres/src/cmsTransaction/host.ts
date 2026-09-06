import { Cause, Clock, Effect, Schema } from "effect";
import { sql } from "drizzle-orm";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { capturePrivateJsonData } from "../privateJsonData";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ApplicationBindingSelectionReader } from "../applicationActivation";
import { captureTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1, type LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";
import { lockScopeClockForShareInTransactionEffect, lockScopeClockForUpdateInTransactionEffect } from "../scopeClock";
import { hasRelationalSessionDatabase, runRelationalSession, type RelationalSession } from "../relationalTransaction/session";
import { RelationalSessionError } from "../relationalTransaction/model";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1, CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { prepareCmsApplicationCommit, enterCmsApplicationCommit, type PointCommitTransactionProofOptionsV1,
  type CmsMaterializationTestHooks } from "../pointCommitTransaction";
import { prepareCmsApplication, withCmsAdmission, requireCmsAdmission } from "./admission";
import { makeCmsRequestLifetime } from "./lifetime";
import { makeCmsDocuments, type CmsDocuments } from "./documents";
import { cmsError, cmsLimits, CmsTransactionError, type CmsRequestContext, type CmsPresentedTransactionId } from "./model";

declare const commandBrand: unique symbol;
export interface CmsCommand { readonly [commandBrand]: true }
export interface CmsCommandContext {
  readonly context: CmsRequestContext;
  readonly transactionId: string;
  readonly documents: CmsDocuments;
  readonly begin: (id?: CmsPresentedTransactionId) => Effect.Effect<string, CmsTransactionError>;
  readonly commit: (id: CmsPresentedTransactionId) => Effect.Effect<never, CmsTransactionError>;
  readonly rollback: (id: CmsPresentedTransactionId) => Effect.Effect<never, CmsTransactionError>;
  readonly nested: (command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}
interface CommandDefinition {
  readonly name: string;
  readonly mode: "read" | "write";
  readonly run: (context: CmsCommandContext, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}
const commands = new WeakMap<object, CommandDefinition>();
const decodeRequestKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);

/** Trusted composition only: no runtime registration and no arbitrary framework hooks. */
export const defineCmsCommand = (definition: CommandDefinition): CmsCommand => {
  // SAFETY: this inert token is authenticated by the private definition registry.
  const token = Object.freeze({}) as CmsCommand;
  commands.set(token, Object.freeze({ ...definition }));
  return token;
};
export interface CmsHostInput<Failure> {
  readonly database: FlarexMetadataDatabase;
  readonly controlDatabase: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  readonly commands: readonly CmsCommand[];
  /** Authenticated by the private composition root; never adapter command input. */
  readonly identityAndAccessPolicy: Json;
  readonly materialization: PointCommitTransactionProofOptionsV1;
}
export interface CmsHost {
  readonly newRequestKey: () => string;
  readonly run: (requestKey: string, command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
  readonly read: (command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}
export interface CmsHostTestHooks extends CmsMaterializationTestHooks {
  /** Physical-driver conformance only; never passed to a registered operation. */
  readonly afterAdmission?: (tx: FlarexMetadataTransaction) => Effect.Effect<void, CmsTransactionError>;
}
const digestBytes = makeLivePrivateSha256V1({
  invalidBudget: () => cmsError("limitExceeded"), invalidBytes: () => cmsError("invalidInput"),
  inputBytesExceeded: () => cmsError("limitExceeded"), unavailable: () => cmsError("resourceFailure"),
  nativeRejected: cause => cmsError("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid CMS SHA-256 output"),
});
const sha256 = Effect.fn("CmsHost.sha256")((bytes: Uint8Array) => digestBytes(bytes, { maximumInputBytes: cmsLimits.commandBytes }));

const projectFailure = (cause: unknown): CmsTransactionError => {
  if (cause instanceof CmsTransactionError) return cause;
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return cmsError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return cmsError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError) return cmsError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return cmsError("invalidAuthority", cause);
};

export const makeCmsHost = Effect.fn("CmsHost.make")(function* <Failure>(
  input: CmsHostInput<Failure>,
  hooks?: CmsHostTestHooks,
): Effect.fn.Return<CmsHost, CmsTransactionError> {
  const { database, session, deploymentId, controlDatabase, application, pointCommitAuthority } = input;
  const compositionAuthority = input.authority;
  const authority = captureTrustedScopeAuthorityResolutionPorts(input.authority);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  if (!hasRelationalSessionDatabase(session, database) || allowed.size === 0 || allowed.size > cmsLimits.calls) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  for (const token of allowed) {
    const definition = commands.get(token);
    if (definition === undefined || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(definition.name) || names.has(definition.name)) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    names.add(definition.name);
  }
  const identity = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, cmsLimits.documentBytes, cmsError));
  const canonicalIdentity = yield* canonicalizeSuccessfulResultV1Effect(identity.value).pipe(Effect.mapError(projectFailure));
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(yield* sha256(canonicalIdentity.canonicalBytes));
  const owner = Object.freeze({ hostId: Symbol("cms.host") });
  const materialization = Object.freeze({ ...input.materialization });
  const testHooks = hooks === undefined ? undefined : Object.freeze({ ...hooks });
  const execute = Effect.fn("CmsHost.execute")(function* (requestKey: string | null, token: CmsCommand, args: Json) {
    const root = commands.get(token);
    if (root === undefined || !allowed.has(token) || (requestKey === null && root.mode !== "read")) return yield* Effect.fail(cmsError("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, cmsLimits.commandBytes, cmsError));
    const key = requestKey === null ? null : yield* Effect.fromResult(decodeRequestKey(requestKey))
      .pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    if (key !== null && !/^cms\/[0-9a-f-]{36}$/.test(key)) return yield* Effect.fail(cmsError("invalidInput"));
    const transactionId = crypto.randomUUID();
    const requestIdentity = Object.freeze({ requestId: Symbol("cms.request") });
    const attempt = Effect.fn("CmsHost.attempt")(function* (recoverOnly: boolean) {
      // Both first entry and uncertain-decision recovery re-authenticate the target.
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(cmsError("invalidAuthority"));
      const prepared = yield* prepareCmsApplication(application, compositionAuthority, controlDatabase, deploymentId);
      const commit = requestKey === null ? null : yield* prepareCmsApplicationCommit(prepared, located.authority, pointCommitAuthority, materialization);
      return yield* runRelationalSession(session, tx => Effect.scoped(Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`),
          cause => cmsError("statementFailure", cause));
        const clock = yield* (requestKey === null ? lockScopeClockForShareInTransactionEffect(tx, located.authority.scopeId) :
          lockScopeClockForUpdateInTransactionEffect(tx, located.authority.scopeId));
        return yield* withCmsAdmission(prepared, tx, located.authority, clock, admission => Effect.gen(function* () {
          const state = yield* requireCmsAdmission(admission);
          if (testHooks?.afterAdmission !== undefined) yield* testHooks.afterAdmission(tx);
          const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId));
          const evidence = yield* canonicalizeSuccessfulResultV1Effect({ domain: "flarex.private.cms-command", version: 1,
            deploymentId, scopeId: located.authority.scopeId, epoch: clock.epoch, storageGeneration: clock.storageGeneration,
            fence: clock.storageGenerationFence.toString(), binding: state.frame, head: { sequence: state.head.sequence.toString(), sha256: state.head.sha256 },
            operation: root.name, args: captured.value });
          const lookup = key === null ? null : {
            scopeUuid: scope.scopeUuid, requestKey: key, expectedIdentityAccessPolicySha256: identityDigest,
            expectedFunctionPath: TransactionFunctionPathV1Schema.make(`__flarex_private_cms/${root.name}`),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* sha256(evidence.canonicalBytes)),
          };
          if (lookup !== null) {
            const outcome = yield* createCommittedPointOutcomeResolverV1(tx).resolve(lookup);
            if (outcome.kind === "available") return outcome.successfulResult.valueJson;
            if (outcome.kind === "expired") return yield* Effect.fail(cmsError("resultUnavailable"));
            // Absence after COMMIT ambiguity is never permission to rerun callbacks.
            if (recoverOnly) return yield* Effect.fail(cmsError("decisionUncertain"));
          }
          const lifetime = yield* makeCmsRequestLifetime(owner, requestIdentity, transactionId, key === null ? "read" : root.mode);
          return yield* Effect.gen(function* () {
            yield* Effect.fromResult(lifetime.charge(captured.bytes + evidence.canonicalBytes.byteLength));
            const participant = commit === null ? null : yield* enterCmsApplicationCommit(commit, admission, lifetime);
            const working = yield* makeCmsDocuments(admission, lifetime, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), participant?.uniqueDefinitions ?? []);
            const invoke = Effect.fn("CmsHost.invoke")(function* (context: CmsRequestContext, child: CmsCommand, childArgs: Json): Effect.fn.Return<Json, CmsTransactionError> {
              const definition = commands.get(child);
              if (definition === undefined || !allowed.has(child) || (key === null && definition.mode !== "read")) return yield* Effect.fail(cmsError("invalidAuthority"));
              const childInput = yield* Effect.fromResult(capturePrivateJsonData(childArgs, lifetime.remainingBytes(), cmsError));
              yield* Effect.fromResult(lifetime.charge(childInput.bytes));
              const commandContext = Object.freeze({ context, transactionId, documents: working.documents,
                begin: id => lifetime.begin(context, id), commit: id => lifetime.adapterCommit(context, id), rollback: id => lifetime.rollback(context, id),
                nested: (next, nextArgs) => lifetime.nested(context, transactionId, nested => invoke(nested, next, nextArgs)) } satisfies CmsCommandContext);
              const value = yield* Effect.suspend(() => definition.run(commandContext, childInput.value));
              const output = yield* Effect.fromResult(capturePrivateJsonData(value, lifetime.remainingBytes(), cmsError));
              yield* Effect.fromResult(lifetime.charge(output.bytes));
              return output.value;
            });
            const value = yield* invoke(lifetime.context, token, captured.value);
            const result = yield* canonicalizeSuccessfulResultV1Effect(value);
            yield* Effect.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
            const digest = yield* sha256(result.canonicalBytes);
            yield* lifetime.seal;
            if (participant !== null && lookup !== null) yield* participant.finalize(yield* working.close(), lookup, result, digest, testHooks);
            return result.valueJson;
          }).pipe(Effect.ensuring(lifetime.close));
        }));
      })));
    });
    return yield* attempt(false).pipe(Effect.catchCause(foreignCause => {
      const cause = Cause.map(foreignCause, projectFailure);
      const reason = cause.reasons[0];
      if (key !== null && cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason) && reason.error.reason === "decisionUncertain") {
        return attempt(true).pipe(Effect.catchCause(recovery => Effect.failCause(Cause.combine(cause, Cause.map(recovery, projectFailure)))));
      }
      return Effect.failCause(cause);
    }));
  });
  return Object.freeze({ newRequestKey: () => `cms/${crypto.randomUUID()}`,
    run: (key, command, args) => execute(key, command, args), read: (command, args) => execute(null, command, args) } satisfies CmsHost);
});
