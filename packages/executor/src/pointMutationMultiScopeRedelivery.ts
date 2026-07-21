import type {
  PointMutationAttemptDiscoveryContinuationV1,
} from "@flarex/persistence-postgres/point-mutation-attempt-discovery";
import type {
  PointMutationRedeliveryScopeCandidateV1,
  PointMutationRedeliveryScopeDiscoveryContinuationV1,
  PointMutationRedeliveryScopeDiscoveryV1,
  PointMutationRedeliveryScopeDiscoveryV1Error,
} from "@flarex/persistence-postgres/point-mutation-redelivery-scope-discovery";
import { Data, Effect, Result, Schema } from "effect";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import {
  FlarexDbV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { TransactionSessionIdV1Schema } from
  "flarex-protocol/transaction-session";

import type {
  PointMutationAttemptRedeliveryDispositionV1,
  PointMutationAttemptRedeliveryPageV1,
  PointMutationAttemptRedeliveryV1,
  PointMutationAttemptRedeliveryV1Error,
} from "./pointMutationAttemptRedelivery";

export const MAX_POINT_MUTATION_MULTI_SCOPE_REDELIVERY_LIMIT_V1 = 100;

export type PointMutationMultiScopeDirectoryStateV1 =
  | Readonly<{ readonly kind: "unstarted" }>
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation:
        PointMutationRedeliveryScopeDiscoveryContinuationV1;
    }>
  | Readonly<{ readonly kind: "exhausted" }>;

export type PointMutationMultiScopeAttemptDiscoveryStateV1 =
  | Readonly<{ readonly kind: "unstarted" }>
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation: PointMutationAttemptDiscoveryContinuationV1;
    }>;

export interface PointMutationMultiScopeQueueEntryV1 {
  readonly locator: PointMutationRedeliveryScopeCandidateV1;
  readonly attemptDiscovery: PointMutationMultiScopeAttemptDiscoveryStateV1;
}

/**
 * Inert operation-local pagination data. Possession or alteration grants no
 * placement, claim, lifecycle, execution, retry, or publication authority.
 */
export interface PointMutationMultiScopeRedeliveryContinuationV1 {
  readonly codecVersion: 1;
  readonly directory: PointMutationMultiScopeDirectoryStateV1;
  readonly scopes: ReadonlyArray<PointMutationMultiScopeQueueEntryV1>;
}

export interface PointMutationMultiScopeRedeliveryProcessedV1 {
  readonly kind: "processed";
  readonly locator: PointMutationRedeliveryScopeCandidateV1;
  readonly page: PointMutationAttemptRedeliveryPageV1;
}

/**
 * Private, non-wire operational evidence. The owned container and locator are
 * frozen, but error identity (including any foreign cause) remains untouched.
 * C06-B owns any future redacted host projection.
 */
export interface PointMutationMultiScopeRedeliveryFailedV1 {
  readonly kind: "failed";
  readonly locator: PointMutationRedeliveryScopeCandidateV1;
  readonly error: PointMutationAttemptRedeliveryV1Error;
}

export type PointMutationMultiScopeRedeliveryScopeResultV1 =
  | PointMutationMultiScopeRedeliveryProcessedV1
  | PointMutationMultiScopeRedeliveryFailedV1;

export interface PointMutationMultiScopeRedeliveryResultV1 {
  readonly scopeDirectoryQueries: 0 | 1;
  readonly attemptPagesCharged: number;
  readonly candidateAttemptsCharged: number;
  readonly scopes: ReadonlyArray<PointMutationMultiScopeRedeliveryScopeResultV1>;
  readonly continuation: PointMutationMultiScopeRedeliveryContinuationV1 | null;
}

export class PointMutationMultiScopeRedeliveryInputV1Error
  extends Data.TaggedError("PointMutationMultiScopeRedeliveryInputV1Error")<{
    readonly reason: "invalidInput";
    readonly cause?: unknown;
  }> {}

export class PointMutationMultiScopeRedeliveryCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationMultiScopeRedeliveryCorruptionV1Error",
  )<{
    readonly reason:
      | "directoryCandidateOverflow"
      | "duplicateScopeLocator"
      | "attemptPageOverflow";
  }> {}

export type PointMutationMultiScopeRedeliveryV1Error =
  | PointMutationMultiScopeRedeliveryInputV1Error
  | PointMutationMultiScopeRedeliveryCorruptionV1Error
  | PointMutationRedeliveryScopeDiscoveryV1Error;

export interface PointMutationMultiScopeRedeliveryV1 {
  readonly sweepEffect: (
    input: unknown,
  ) => Effect.Effect<
    PointMutationMultiScopeRedeliveryResultV1,
    PointMutationMultiScopeRedeliveryV1Error,
    never
  >;
}

const BoundedLimitSchema = Schema.Int.check(Schema.isBetween({
  minimum: 1,
  maximum: MAX_POINT_MUTATION_MULTI_SCOPE_REDELIVERY_LIMIT_V1,
}));

const CanonicalPostgresIsoTimestampSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalIsoTimestamp(value) && /^(?!0000-)[0-9]{4}-/.test(value)
      ? undefined
      : "Expected a canonical PostgreSQL-safe ISO timestamp"
  ),
);

const CanonicalPositiveInt64TextSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!/^[1-9][0-9]*$/.test(value)) {
      return "Expected a canonical positive signed-int64 integer";
    }
    try {
      return BigInt(value) <= MAX_PERSISTED_SIGNED_INT64_V1
        ? undefined
        : "Value exceeds PostgreSQL signed bigint";
    } catch {
      return "Expected a canonical positive signed-int64 integer";
    }
  }),
);

const ScopeLocatorSchema = Schema.Struct({
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
});

const ScopeDiscoveryContinuationSchema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  highWaterScopeId: ScopeIdSchema,
  lastScopeId: ScopeIdSchema,
});

const AttemptDiscoveryContinuationSchema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  storageGeneration: FlarexDbV1StorageGenerationSchema,
  storageGenerationFence: CanonicalPositiveInt64TextSchema,
  epoch: ScopeEpochSchema,
  horizon: CanonicalPostgresIsoTimestampSchema,
  lastEligibleAt: CanonicalPostgresIsoTimestampSchema,
  lastSource: Schema.Literals(["expiredClaim", "finishingSession"]),
  lastSessionId: TransactionSessionIdV1Schema,
  lastAttemptFence: CanonicalPositiveInt64TextSchema,
});

const DirectoryStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unstarted") }),
  Schema.Struct({
    kind: Schema.Literal("continuing"),
    continuation: ScopeDiscoveryContinuationSchema,
  }),
  Schema.Struct({ kind: Schema.Literal("exhausted") }),
]);

const AttemptDiscoveryStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unstarted") }),
  Schema.Struct({
    kind: Schema.Literal("continuing"),
    continuation: AttemptDiscoveryContinuationSchema,
  }),
]);

const QueueEntrySchema = Schema.Struct({
  locator: ScopeLocatorSchema,
  attemptDiscovery: AttemptDiscoveryStateSchema,
});

const ContinuationSchema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  directory: DirectoryStateSchema,
  scopes: Schema.Array(QueueEntrySchema).check(Schema.isMaxLength(
    MAX_POINT_MUTATION_MULTI_SCOPE_REDELIVERY_LIMIT_V1,
  )),
});

const InputSchema = Schema.Struct({
  scopeLimit: BoundedLimitSchema,
  maxAttemptPages: BoundedLimitSchema,
  maxCandidateAttempts: BoundedLimitSchema,
  continuation: Schema.optional(ContinuationSchema),
});

const decodeInputResult = Schema.decodeUnknownResult(InputSchema, {
  onExcessProperty: "error",
});

type DecodedInputV1 = typeof InputSchema.Type;

export function createPointMutationMultiScopeRedeliveryV1(
  scopeDiscovery: Pick<
    PointMutationRedeliveryScopeDiscoveryV1,
    "discoverEffect"
  >,
  redelivery: Pick<PointMutationAttemptRedeliveryV1, "sweepEffect">,
): PointMutationMultiScopeRedeliveryV1 {
  const sweepEffect: PointMutationMultiScopeRedeliveryV1["sweepEffect"] =
    Effect.fn("PointMutationMultiScopeRedelivery.sweep")(function* (rawInput) {
      const input = yield* decodeInput(rawInput);
      let directory = input.continuation === undefined
        ? captureDirectoryState({ kind: "unstarted" })
        : captureDirectoryState(input.continuation.directory);
      const queue = input.continuation === undefined
        ? []
        : input.continuation.scopes.map(captureQueueEntry);
      const queuedKeys = new Set(queue.map(({ locator }) =>
        scopeLocatorKey(locator)
      ));
      const scopeResults: PointMutationMultiScopeRedeliveryScopeResultV1[] = [];
      let scopeDirectoryQueries: 0 | 1 = 0;
      let attemptPagesCharged = 0;
      let candidateAttemptsCharged = 0;

      const availableCapacity =
        MAX_POINT_MUTATION_MULTI_SCOPE_REDELIVERY_LIMIT_V1 - queue.length;
      if (directory.kind !== "exhausted" && availableCapacity > 0) {
        const directoryLimit = Math.min(input.scopeLimit, availableCapacity);
        const directoryPage = yield* scopeDiscovery.discoverEffect({
          limit: directoryLimit,
          ...(directory.kind === "continuing"
            ? { continuation: directory.continuation }
            : {}),
        });
        scopeDirectoryQueries = 1;
        if (directoryPage.candidates.length > directoryLimit) {
          return yield* new PointMutationMultiScopeRedeliveryCorruptionV1Error({
            reason: "directoryCandidateOverflow",
          });
        }
        for (const candidate of directoryPage.candidates) {
          const locator = captureLocator(candidate);
          const key = scopeLocatorKey(locator);
          if (queuedKeys.has(key)) {
            return yield* new PointMutationMultiScopeRedeliveryCorruptionV1Error({
              reason: "duplicateScopeLocator",
            });
          }
          queuedKeys.add(key);
          queue.push(Object.freeze({
            locator,
            attemptDiscovery: Object.freeze({ kind: "unstarted" }),
          }));
        }
        directory = directoryPage.continuation === null
          ? Object.freeze({ kind: "exhausted" })
          : Object.freeze({
            kind: "continuing",
            continuation: captureScopeDiscoveryContinuation(
              directoryPage.continuation,
            ),
          });
      }

      while (
        queue.length > 0 &&
        attemptPagesCharged < input.maxAttemptPages &&
        candidateAttemptsCharged < input.maxCandidateAttempts
      ) {
        const current = queue.shift();
        if (current === undefined) break;
        queuedKeys.delete(scopeLocatorKey(current.locator));
        const pageResult = yield* Effect.result(redelivery.sweepEffect({
          deploymentId: current.locator.deploymentId,
          scopeId: current.locator.scopeId,
          limit: 1,
          ...(current.attemptDiscovery.kind === "continuing"
            ? { continuation: current.attemptDiscovery.continuation }
            : {}),
        }));
        attemptPagesCharged += 1;
        if (Result.isFailure(pageResult)) {
          candidateAttemptsCharged += 1;
          scopeResults.push(Object.freeze({
            kind: "failed",
            locator: captureLocator(current.locator),
            error: pageResult.failure,
          }));
          continue;
        }

        const page = capturePage(pageResult.success);
        if (page.items.length > 1) {
          return yield* new PointMutationMultiScopeRedeliveryCorruptionV1Error({
            reason: "attemptPageOverflow",
          });
        }
        candidateAttemptsCharged += page.items.length;
        scopeResults.push(Object.freeze({
          kind: "processed",
          locator: captureLocator(current.locator),
          page,
        }));
        if (page.continuation !== null) {
          const queued = Object.freeze({
            locator: captureLocator(current.locator),
            attemptDiscovery: Object.freeze({
              kind: "continuing",
              continuation: captureAttemptDiscoveryContinuation(
                page.continuation,
              ),
            }),
          }) satisfies PointMutationMultiScopeQueueEntryV1;
          queuedKeys.add(scopeLocatorKey(queued.locator));
          queue.push(queued);
        }
      }

      const continuation = directory.kind === "exhausted" && queue.length === 0
        ? null
        : Object.freeze({
          codecVersion: 1,
          directory: captureDirectoryState(directory),
          scopes: Object.freeze(queue.map(captureQueueEntry)),
        }) satisfies PointMutationMultiScopeRedeliveryContinuationV1;

      return Object.freeze({
        scopeDirectoryQueries,
        attemptPagesCharged,
        candidateAttemptsCharged,
        scopes: Object.freeze(scopeResults),
        continuation,
      });
    });

  return Object.freeze({ sweepEffect });
}

function decodeInput(
  rawInput: unknown,
): Effect.Effect<DecodedInputV1, PointMutationMultiScopeRedeliveryInputV1Error> {
  return Effect.fromResult(decodeInputResult(rawInput).pipe(
    Result.mapError((cause) =>
      new PointMutationMultiScopeRedeliveryInputV1Error({
        reason: "invalidInput",
        cause,
      })
    ),
    Result.flatMap((input) => {
      if (
        input.maxCandidateAttempts > input.maxAttemptPages ||
        !validContinuationState(input.continuation)
      ) {
        return Result.fail(new PointMutationMultiScopeRedeliveryInputV1Error({
          reason: "invalidInput",
        }));
      }
      const keys = input.continuation?.scopes.map(({ locator }) =>
        scopeLocatorKey(locator)
      ) ?? [];
      return new Set(keys).size === keys.length
        ? Result.succeed(input)
        : Result.fail(new PointMutationMultiScopeRedeliveryInputV1Error({
          reason: "invalidInput",
        }));
    }),
  ));
}

function validContinuationState(
  continuation: DecodedInputV1["continuation"],
): boolean {
  if (continuation === undefined) return true;
  return continuation.directory.kind !== "unstarted" ||
    continuation.scopes.length === 0;
}

function scopeLocatorKey(
  locator: PointMutationRedeliveryScopeCandidateV1,
): string {
  return `${locator.deploymentId}\u0000${locator.scopeId}`;
}

function captureLocator(
  locator: PointMutationRedeliveryScopeCandidateV1,
): PointMutationRedeliveryScopeCandidateV1 {
  return Object.freeze({
    deploymentId: locator.deploymentId,
    scopeId: locator.scopeId,
  });
}

function captureDirectoryState(
  state: PointMutationMultiScopeDirectoryStateV1,
): PointMutationMultiScopeDirectoryStateV1 {
  return state.kind === "continuing"
    ? Object.freeze({
      kind: "continuing",
      continuation: captureScopeDiscoveryContinuation(state.continuation),
    })
    : Object.freeze({ kind: state.kind });
}

function captureQueueEntry(
  entry: PointMutationMultiScopeQueueEntryV1,
): PointMutationMultiScopeQueueEntryV1 {
  return Object.freeze({
    locator: captureLocator(entry.locator),
    attemptDiscovery: entry.attemptDiscovery.kind === "continuing"
      ? Object.freeze({
        kind: "continuing",
        continuation: captureAttemptDiscoveryContinuation(
          entry.attemptDiscovery.continuation,
        ),
      })
      : Object.freeze({ kind: "unstarted" }),
  });
}

function captureScopeDiscoveryContinuation(
  continuation: PointMutationRedeliveryScopeDiscoveryContinuationV1,
): PointMutationRedeliveryScopeDiscoveryContinuationV1 {
  return Object.freeze({ ...continuation });
}

function captureAttemptDiscoveryContinuation(
  continuation: PointMutationAttemptDiscoveryContinuationV1,
): PointMutationAttemptDiscoveryContinuationV1 {
  return Object.freeze({ ...continuation });
}

function capturePage(
  page: PointMutationAttemptRedeliveryPageV1,
): PointMutationAttemptRedeliveryPageV1 {
  return Object.freeze({
    horizon: page.horizon,
    items: Object.freeze(page.items.map((item) => Object.freeze({
      candidate: Object.freeze({
        selector: Object.freeze({ ...item.candidate.selector }),
        source: item.candidate.source,
        eligibleAt: item.candidate.eligibleAt,
      }),
      disposition: captureDisposition(item.disposition),
    }))),
    continuation: page.continuation === null
      ? null
      : captureAttemptDiscoveryContinuation(page.continuation),
  });
}

function captureDisposition(
  disposition: PointMutationAttemptRedeliveryDispositionV1,
): PointMutationAttemptRedeliveryDispositionV1 {
  switch (disposition.kind) {
    case "published":
    case "replayed":
    case "expired":
      return Object.freeze({
        kind: disposition.kind,
        token: Object.freeze({ ...disposition.token }),
      });
    case "busy":
      return Object.freeze({ kind: "busy" });
    case "closed":
      return Object.freeze({ ...disposition });
  }
}
