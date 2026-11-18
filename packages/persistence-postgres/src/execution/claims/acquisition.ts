import type { FlarexMetadataDatabase } from "../../application/deployments";
import type {
  CommittedPointOutcomeResolverV1,
  ResolveCommittedPointOutcomeInputV1,
} from "../../commit/committedPointOutcome";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
  runPointCommitPromiseEffect,
} from "../../commit/point/promiseBoundary";
import type {
  RunLocatedReadCommittedTransactionV1,
} from "../../database/locatedTransactionIdentity";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import {
  fxSystemIdempotency,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionSessions,
} from "../../database/schema";
import {
  TrustedScopeAuthorityPortError,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
} from "../../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { readFiniteAttemptAnchorRow } from "../finiteAttemptAnchor";
import { LocatedReadCommittedTransactionFailureV1 } from "../readCommittedTransactionFailure";
import {
  lockPointMutationSessionAttemptStructure,
  lockPointMutationSessionClock,
  readDatabaseNow,
  requireExactPointMutationSessionJournalRoot,
  requireStablePointMutationSessionAttemptAuthority,
  type LockedPointMutationSessionClockV1,
  type PointMutationSessionAttemptAuthorityFailureFactoryV1,
  type PointMutationSessionStableAuthorityFailureFactoryV1,
} from "../session/attemptAuthority";
import { observePointMutationSessionAttemptFacet } from "../session/attemptLoad";
import {
  ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
  type LocatedPointMutationExecutionClaimAcquisitionTargetV1,
  type PointMutationExecutionClaimAcquisitionOptionsV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../session/constructionContracts";
import type {
  PointMutationExecutionClaimAbortReasonV1,
  PointMutationExecutionClaimAcquisitionResultV1,
  PointMutationExecutionClaimAcquisitionV1,
  PointMutationSessionAttemptSelectorV1,
  TransactionSessionRow,
} from "../session/contracts";
import {
  PointMutationSessionAuthorityCorruptionV1Error,
  projectTransactionSessionActivationResult,
} from "../session/errors";
import { finiteEntryAttemptContextFromAnchor } from "../session/finiteSession";
import { captureAttemptSelector } from "../session/inputCapture";
import { issueFiniteRecoveryAttempt } from "../session/recoveryCapture";
import {
  PointMutationExecutionClaimAcquisitionConfigurationV1Error,
  PointMutationExecutionClaimAcquisitionCorruptionV1Error,
  PointMutationExecutionClaimAcquisitionInputV1Error,
  PointMutationExecutionClaimAcquisitionPersistenceV1Error,
  PointMutationExecutionClaimAcquisitionResourceV1Error,
  PointMutationExecutionClaimAcquisitionStaleV1Error,
  TransactionExecutionClaimCorruptionV1Error,
  type PointMutationExecutionClaimAcquisitionV1Error,
} from "./transactionExecutionClaimErrors";
import {
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimOwnerV1,
} from "./transactionExecutionClaimModel";
import {
  deriveTransactionExecutionClaimV1,
  inspectTransactionExecutionClaimV1Result,
  lockExactTransactionExecutionClaimV1Result,
} from "./transactionExecutionClaimPersistence";
import { bytesEqual, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionAttemptFenceSchema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  type TransactionAttemptFence,
} from "flarex-protocol/transaction-session";

export function createPointMutationExecutionClaimAcquisitionV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointMutationExecutionClaimAcquisitionOptionsV1,
): PointMutationExecutionClaimAcquisitionV1 {
  const durationMilliseconds = requireExecutionClaimAcquisitionDuration(
    options.durationMilliseconds,
  );
  const randomOwner = options.randomOwner ?? (() => crypto.randomUUID());
  const acquireEffect = Effect.fn(function* (
    input: PointMutationSessionAttemptSelectorV1,
  ): Effect.fn.Return<
    PointMutationExecutionClaimAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  > {
    const selector = yield* Effect.fromResult(
      captureAttemptSelector(input).pipe(Result.mapError((cause) =>
        new PointMutationExecutionClaimAcquisitionInputV1Error({
          reason: "invalidSelector",
          cause,
        })
      )),
    );
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: selector.deploymentId, scopeId: selector.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapExecutionClaimAcquisitionAuthorityError));
    if (located.authority.scopeId !== selector.scopeId) {
      return yield* Effect.fail(
        new PointMutationExecutionClaimAcquisitionStaleV1Error({
          reason: "scopeChanged",
        }),
      );
    }
    const candidate = located.target;
    if (
      typeof Reflect.get(
        candidate,
        ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
      ) !== "function"
    ) {
      return yield* Effect.fail(
        new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
          operation: "prelude",
          cause: new Error(
            "Located scope target cannot acquire execution claims.",
          ),
        }),
      );
    }
    // SAFETY: the Reflect.get check above proved the candidate carries the
    // acquisition method, so it satisfies the located target brand.
    const target = candidate as LocatedPointMutationExecutionClaimAcquisitionTargetV1;
    return yield* target[ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]({
      selector,
      preliminaryAuthority: located.authority,
      durationMilliseconds,
      randomOwner,
    });
  });
  return Object.freeze({ acquireEffect });
}

interface PointMutationExecutionClaimAcquisitionPreludeV1 {
  readonly lookup: ResolveCommittedPointOutcomeInputV1;
  readonly attemptFence: TransactionAttemptFence;
}

type PointMutationExecutionClaimAcquisitionTransactionResultV1 =
  | Readonly<{ readonly kind: "outcomeObserved" }>
  | Exclude<
      PointMutationExecutionClaimAcquisitionResultV1,
      Readonly<{ readonly kind: "replayed" }>
    >;

export const acquireLocatedPointMutationExecutionClaimEffect = Effect.fn(function* (
  db: FlarexMetadataDatabase,
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
  outcomeResolver: CommittedPointOutcomeResolverV1,
  input: Readonly<{
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
    readonly durationMilliseconds: number;
    readonly randomOwner: () => string;
  }>,
): Effect.fn.Return<
  PointMutationExecutionClaimAcquisitionResultV1,
  PointMutationExecutionClaimAcquisitionV1Error
> {
  const prelude = yield* Effect.uninterruptible(
    loadExecutionClaimAcquisitionPrelude(db, input.selector),
  );
  const initialOutcome = yield* outcomeResolver.resolve(prelude.lookup);
  if (initialOutcome.kind !== "missing") {
    return Object.freeze({
      kind: "replayed",
      outcome: initialOutcome,
    });
  }

  const rawOwner = yield* Effect.try({
    try: input.randomOwner,
    catch: (cause) =>
      new PointMutationExecutionClaimAcquisitionConfigurationV1Error({
        reason: "claimOwnerGenerationFailed",
        cause,
      }),
  });
  const claimOwner = yield* Effect.fromResult(
    decodeTransactionExecutionClaimOwnerV1(rawOwner).pipe(Result.mapError(() =>
      new PointMutationExecutionClaimAcquisitionConfigurationV1Error({
        reason: "claimOwnerInvalid",
      })
    )),
  );

  const transactionResult = yield* Effect.uninterruptible(
    runPointCommitPromiseEffect(() => runReadCommitted((tx) =>
        acquireExecutionClaimInTransaction(
          tx,
          {
            selector: input.selector,
            preliminaryAuthority: input.preliminaryAuthority,
            durationMilliseconds: input.durationMilliseconds,
            claimOwner: claimOwner,
          },
          prelude,
        )), mapExecutionClaimAcquisitionTransactionFailure),
  );
  if (transactionResult.kind !== "outcomeObserved") {
    return transactionResult;
  }
  const settledOutcome = yield* outcomeResolver.resolve(prelude.lookup);
  if (settledOutcome.kind === "missing") {
    return yield* Effect.fail(
      new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
        reason: "committedOutcomeMissing",
      }),
    );
  }
  return Object.freeze({ kind: "replayed", outcome: settledOutcome });
});

const decodePreludeAttemptFence = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);
const decodePreludeRequestKey = Schema.decodeUnknownResult(
  Schema.toType(TransactionRequestKeyV1Schema),
);
const decodePreludeIdentityAccessPolicySha256 = Schema.decodeUnknownResult(
  Schema.toType(TransactionIdentityAccessPolicySha256V1Schema),
);
const decodePreludeFunctionPath = Schema.decodeUnknownResult(
  Schema.toType(TransactionFunctionPathV1Schema),
);
const decodePreludeRequestSha256 = Schema.decodeUnknownResult(
  Schema.toType(TransactionRequestSha256V1Schema),
);

const loadExecutionClaimAcquisitionPrelude = Effect.fn(function* (
  db: FlarexMetadataDatabase,
  selector: PointMutationSessionAttemptSelectorV1,
): Effect.fn.Return<
  PointMutationExecutionClaimAcquisitionPreludeV1,
  | PointMutationExecutionClaimAcquisitionStaleV1Error
  | PointMutationExecutionClaimAcquisitionCorruptionV1Error
  | PointMutationExecutionClaimAcquisitionPersistenceV1Error
> {
  const scopeUuid = projectScopeIdUuidV1(selector.scopeId).scopeUuid;
  const rows = yield* runDrizzleStatementEffect(db.select({
    scopeUuid: fxSystemTransactionSessions.scopeUuid,
    sessionId: fxSystemTransactionSessions.sessionId,
    attemptFence: fxSystemTransactionSessions.attemptFence,
    requestKey: fxSystemTransactionSessions.requestKey,
    identityAccessPolicySha256:
      fxSystemTransactionSessions.identityAccessPolicySha256,
    functionPath: fxSystemTransactionSessions.functionPath,
    requestSha256: fxSystemTransactionSessions.requestSha256,
  }).from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
    eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
  )).limit(2), mapExecutionClaimAcquisitionPreludeFailure);
  const row = rows[0];
  if (rows.length === 0 || row === undefined) {
    return yield* Effect.fail(new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptMissing",
    }));
  }
  if (rows.length !== 1) {
    return yield* Effect.fail(new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "preludeInvalid",
    }));
  }
  if (
    row.scopeUuid !== scopeUuid ||
    row.sessionId !== selector.sessionId ||
    !isUint8ArrayWithByteLength(row.identityAccessPolicySha256, 32) ||
    !isUint8ArrayWithByteLength(row.requestSha256, 32)
  ) {
    return yield* Effect.fail(new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "preludeInvalid",
    }));
  }
  return yield* Effect.fromResult(Result.gen(function* () {
    const attemptFence = yield* decodePreludeAttemptFence(row.attemptFence);
    const requestKey = yield* decodePreludeRequestKey(row.requestKey);
    const expectedIdentityAccessPolicySha256 = yield* decodePreludeIdentityAccessPolicySha256(
      new Uint8Array(row.identityAccessPolicySha256),
    );
    const expectedFunctionPath = yield* decodePreludeFunctionPath(row.functionPath);
    const expectedRequestSha256 = yield* decodePreludeRequestSha256(
      new Uint8Array(row.requestSha256),
    );
    return Object.freeze({
      attemptFence,
      lookup: Object.freeze({
        scopeUuid,
        requestKey,
        expectedIdentityAccessPolicySha256,
        expectedFunctionPath,
        expectedRequestSha256,
      }),
    });
  }).pipe(Result.mapError(cause =>
    new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "preludeInvalid",
      cause,
    })
  )));
});

async function acquireExecutionClaimInTransaction(
  tx: AppRowTransaction,
  input: Readonly<{
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
    readonly durationMilliseconds: number;
    readonly claimOwner: TransactionExecutionClaimOwnerV1;
  }>,
  prelude: PointMutationExecutionClaimAcquisitionPreludeV1,
): Promise<PointMutationExecutionClaimAcquisitionTransactionResultV1> {
  const selector = input.selector;
  const clock = await lockPointMutationSessionClock(tx, selector.scopeId);
  requireStableExecutionClaimAcquisitionAuthority(
    clock,
    input.preliminaryAuthority,
    selector,
  );

  const outcomeRows = await tx.select({
    requestKey: fxSystemIdempotency.requestKey,
  }).from(fxSystemIdempotency).where(and(
    eq(fxSystemIdempotency.scopeUuid, clock.scopeUuid),
    eq(fxSystemIdempotency.requestKey, prelude.lookup.requestKey),
  )).limit(2).for("update");
  if (outcomeRows.length > 1) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "committedOutcomeInvalid",
    });
  }
  if (outcomeRows[0] !== undefined) {
    return Object.freeze({ kind: "outcomeObserved" });
  }

  const sessionRows = await tx.select().from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
    )).limit(2).for("update");
  const session = sessionRows[0];
  if (sessionRows.length === 0 || session === undefined) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptMissing",
    });
  }
  if (sessionRows.length !== 1) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (session.attemptFence !== selector.attemptFence) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptReplaced",
    });
  }
  if (!sessionMatchesExecutionClaimPrelude(session, prelude)) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (session.lifecycle === "committed") {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "committedOutcomeMissing",
    });
  }
  if (session.executionProfile === "finiteRoot" && (session.lifecycle === "running" || session.lifecycle === "retrying")) {
    const context = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(readFiniteAttemptAnchorRow(session)
      .pipe(Effect.mapError(cause => new PointMutationExecutionClaimAcquisitionCorruptionV1Error({ reason: "sessionInvalid", cause })))));
    const databaseNow = await readDatabaseNow(tx, selector.scopeId);
    if (session.lifecycle === "running" && Date.parse(context.executionClaim.claimExpiresAt) > databaseNow.getTime())
      return Object.freeze({ kind: "busy", observation: context.executionClaim });
    const evidence = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      finiteEntryAttemptContextFromAnchor(context, selector.deploymentId, clock.record, databaseNow)));
    const capture = issueFiniteRecoveryAttempt(evidence);
    return Object.freeze({ kind: "finiteRecovery", capture });
  }
  if (session.lifecycle === "finishing") {
    return Object.freeze({ kind: "finishing" });
  }
  if (session.lifecycle !== "running") {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "lifecycle",
    });
  }

  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: selector.scopeId,
      authorityProfile: "liveExecution",
      failures: executionClaimAcquisitionAuthorityFailures,
      afterLeaseLock: undefined,
    },
    clock,
    session,
    "requireRetainedSnapshot",
  );
  if (locked.leaseState === "absent") {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "leaseInvalid",
    });
  }
  const root = await requireExactPointMutationSessionJournalRoot(
    tx,
    selector.scopeId,
    clock.scopeUuid,
    locked.sessionId,
    locked.attemptFence,
    undefined,
  );
  const claimRow = projectTransactionSessionActivationResult(
    await lockExactTransactionExecutionClaimV1Result(tx, {
      scopeId: selector.scopeId,
      scopeUuid: clock.scopeUuid,
      sessionId: locked.sessionId,
      attemptFence: locked.attemptFence,
    }),
  );
  const databaseNow = await readDatabaseNow(tx, selector.scopeId);
  const now = finiteDateMilliseconds(databaseNow);
  const grantExpiresAt = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAt = finiteDateMilliseconds(session.hardExpiresAt);
  if (
    now === undefined ||
    grantExpiresAt === undefined ||
    hardExpiresAt === undefined
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (
    root.state === "sealed" &&
    locked.leaseExpiresAtMilliseconds !== Math.min(
      grantExpiresAt,
      hardExpiresAt,
    )
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "leaseInvalid",
    });
  }
  if (grantExpiresAt <= now || hardExpiresAt <= now) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "authorizationExpired",
    });
  }
  if (locked.leaseExpiresAtMilliseconds <= now) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "leaseExpired",
    });
  }

  const current = projectTransactionSessionActivationResult(
    inspectTransactionExecutionClaimV1Result(selector.scopeId, claimRow),
  );
  const currentClaimedAt = Date.parse(current.claimedAt);
  const currentExpiry = Date.parse(current.claimExpiresAt);
  if (currentClaimedAt > now) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "claimInvalid",
    });
  }
  if (currentExpiry > now) {
    return Object.freeze({ kind: "busy", observation: current });
  }

  let disposition:
    | Readonly<{
        readonly mode: "execute" | "finishOnly" | "replaceRelationConflict";
      }>
    | Readonly<{
        readonly mode: "abortOnly";
        readonly reason: PointMutationExecutionClaimAbortReasonV1;
      }>;
  if (root.state === "sealed") {
    disposition = { mode: "finishOnly" };
  } else if (root.state === "relation_conflicted") {
    disposition = { mode: "replaceRelationConflict" };
  } else if (root.state === "open") {
    // A finite root can have tentative child results in its lost evaluator
    // while its durable journal still looks pristine. Never resume that root
    // under the same attempt fence after the execution claim expires.
    if (root.executionProfile === "finiteRoot") {
      disposition = { mode: "abortOnly", reason: "dirtyOpen" };
    } else {
      const facet = await observePointMutationSessionAttemptFacet(
        tx,
        clock,
        session,
        locked,
        root,
      );
      disposition = facet.kind !== "pristineOpen"
        ? { mode: "abortOnly", reason: "dirtyOpen" }
        : { mode: "execute" };
    }
  } else {
    disposition = { mode: "abortOnly", reason: "failedRoot" };
  }

  if (current.claimFence >= MAX_PERSISTED_SIGNED_INT64_V1) {
    throw new PointMutationExecutionClaimAcquisitionResourceV1Error({
      dimension: "claimFence",
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    });
  }
  const mutationDatabaseNow = await readDatabaseNow(tx, selector.scopeId);
  const mutationNow = finiteDateMilliseconds(mutationDatabaseNow);
  if (mutationNow === undefined) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (grantExpiresAt <= mutationNow || hardExpiresAt <= mutationNow) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "authorizationExpired",
    });
  }
  if (locked.leaseExpiresAtMilliseconds <= mutationNow) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "leaseExpired",
    });
  }
  const next = deriveTransactionExecutionClaimV1({
    scopeUuid: clock.scopeUuid,
    sessionId: locked.sessionId,
    attemptFence: locked.attemptFence,
    claimFence: current.claimFence + 1n,
    claimOwner: input.claimOwner,
    databaseNow: mutationDatabaseNow,
    durationMilliseconds: input.durationMilliseconds,
    leaseExpiresAt: locked.lease.leaseExpiresAt,
    authorizationGrantExpiresAt: session.authorizationGrantExpiresAt,
    hardExpiresAt: session.hardExpiresAt,
  });
  const renewedClaim = Result.match(next, {
    onSuccess: (renewed) => renewed,
    onFailure: (failure) => {
      throw failure === "authorityExpired"
        ? new PointMutationExecutionClaimAcquisitionStaleV1Error({
            reason: "authorizationExpired",
          })
        : new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
            reason: "claimInvalid",
          });
    },
  });
  const updated = await tx.update(fxSystemTransactionExecutionClaims).set({
    claimFence: renewedClaim.claimFence,
    claimOwner: renewedClaim.claimOwner,
    claimedAt: renewedClaim.claimedAt,
    claimExpiresAt: renewedClaim.claimExpiresAt,
  }).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(fxSystemTransactionExecutionClaims.sessionId, locked.sessionId),
    eq(fxSystemTransactionExecutionClaims.attemptFence, locked.attemptFence),
    eq(fxSystemTransactionExecutionClaims.claimFence, current.claimFence),
    eq(fxSystemTransactionExecutionClaims.claimOwner, current.claimOwner),
  )).returning({
    claimFence: fxSystemTransactionExecutionClaims.claimFence,
    claimOwner: fxSystemTransactionExecutionClaims.claimOwner,
    claimedAt: fxSystemTransactionExecutionClaims.claimedAt,
    claimExpiresAt: fxSystemTransactionExecutionClaims.claimExpiresAt,
  });
  if (
    updated.length !== 1 ||
    updated[0]?.claimFence !== renewedClaim.claimFence ||
    updated[0]?.claimOwner !== renewedClaim.claimOwner
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "claimMutationInvalid",
    });
  }
  const observation = Object.freeze({
    claimOwner: renewedClaim.claimOwner,
    claimFence: renewedClaim.claimFence,
    claimedAt: renewedClaim.claimedAt.toISOString(),
    claimExpiresAt: renewedClaim.claimExpiresAt.toISOString(),
  });
  if (disposition.mode === "abortOnly") {
    return Object.freeze({
      kind: "acquired",
      mode: disposition.mode,
      reason: disposition.reason,
      observation,
    });
  }
  return Object.freeze({
    kind: "acquired",
    mode: disposition.mode,
    observation,
  });
}

const executionClaimAcquisitionAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  authorizationRevocationEpochChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "revocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);

function requireStableExecutionClaimAcquisitionAuthority(
  clock: LockedPointMutationSessionClockV1,
  preliminary: TrustedScopeAuthority,
  selector: PointMutationSessionAttemptSelectorV1,
): void {
  if (preliminary.deploymentId !== selector.deploymentId) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "deploymentChanged",
    });
  }
  projectTransactionSessionActivationResult(requireStablePointMutationSessionAttemptAuthority(
    clock,
    { selector, preliminaryAuthority: preliminary },
    executionClaimAcquisitionStableAuthorityFailures,
  ));
}

const executionClaimAcquisitionStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "scopeChanged",
    }),
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

function sessionMatchesExecutionClaimPrelude(
  session: TransactionSessionRow,
  prelude: PointMutationExecutionClaimAcquisitionPreludeV1,
): boolean {
  return session.attemptFence === prelude.attemptFence &&
    session.requestKey === prelude.lookup.requestKey &&
    session.functionPath === prelude.lookup.expectedFunctionPath &&
    isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32) &&
    bytesEqual(
      session.identityAccessPolicySha256,
      prelude.lookup.expectedIdentityAccessPolicySha256,
    ) &&
    isUint8ArrayWithByteLength(session.requestSha256, 32) &&
    bytesEqual(session.requestSha256, prelude.lookup.expectedRequestSha256);
}

function mapExecutionClaimAcquisitionPreludeFailure(
  cause: unknown,
): PointMutationExecutionClaimAcquisitionStaleV1Error |
  PointMutationExecutionClaimAcquisitionCorruptionV1Error |
  PointMutationExecutionClaimAcquisitionPersistenceV1Error {
  if (
    cause instanceof PointMutationExecutionClaimAcquisitionStaleV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionCorruptionV1Error
  ) return cause;
  return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
    operation: "prelude",
    cause,
  });
}

function mapExecutionClaimAcquisitionAuthorityError(
  error: TrustedScopeAuthorityError,
): PointMutationExecutionClaimAcquisitionStaleV1Error |
  PointMutationExecutionClaimAcquisitionCorruptionV1Error |
  PointMutationExecutionClaimAcquisitionPersistenceV1Error {
  if (error instanceof TrustedScopeAuthorityPortError) {
    return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
      operation: "prelude",
      cause: error.cause,
    });
  }

  const failure = error.failure;
  switch (failure.reason) {
    case "scopeMetadataMissing":
    case "scopeMetadataAmbiguous":
    case "scopeDeploymentMismatch":
      return new PointMutationExecutionClaimAcquisitionStaleV1Error({
        reason: "deploymentChanged",
      });
    case "splitProvisioningReceiptMissing":
    case "splitProvisioningReceiptScopeMismatch":
    case "splitProvisioningReceiptNotReady":
    case "splitProvisioningReceiptPlacementMismatch":
    case "scopeClockTargetPlacementMismatch":
    case "scopeClockMissing":
      return new PointMutationExecutionClaimAcquisitionStaleV1Error({
        reason: "scopeChanged",
      });
    case "scopeClockTargetResolutionFailed":
      return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
        operation: "prelude",
        cause: failure.resolutionCause,
      });
    case "scopeClockTargetInvalid":
    case "scopeClockScopeMismatch":
      return new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
        reason: "preludeInvalid",
        cause: error,
      });
    default: {
      const unhandledFailure: never = failure;
      return unhandledFailure;
    }
  }
}

function mapExecutionClaimAcquisitionTransactionFailure(
  cause: unknown,
): PointMutationExecutionClaimAcquisitionV1Error {
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack"
  ) {
    return mapExecutionClaimAcquisitionTransactionFailure(
      cause.issue.callbackCause,
    );
  }
  if (
    cause instanceof PointMutationExecutionClaimAcquisitionStaleV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionCorruptionV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionResourceV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionPersistenceV1Error
  ) return cause;
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "claimInvalid",
      cause,
    });
  }
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: cause.issue === "snapshotLeaseInvalid"
        ? "leaseInvalid"
        : cause.issue === "journalRootInvalid" ||
            cause.issue === "activeJournalRootMissing"
        ? "journalRootInvalid"
        : "sessionInvalid",
      cause,
    });
  }
  return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
    operation: "transaction",
    cause,
  });
}

function requireExecutionClaimAcquisitionDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationExecutionClaimAcquisitionConfigurationV1Error({
      reason: "invalidClaimDuration",
    });
  }
  return value;
}
