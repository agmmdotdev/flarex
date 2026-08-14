import type {
  DeclarativeV2AnalyzerCompleteV1,
  DeclarativeV2AnalyzerRestartEvidenceClaimV1,
  DeclarativeV2VerifierRestartProducerStepV1,
} from "@flarex/analysis/internal/system-test/declarative-v2-verifier-v1";
import type {
  DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
} from "@flarex/executor-http/internal/system-test/declarative-v2-authenticated-command-restart-input-v1";
import {
  DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error,
  type AuthenticatedDeclarativeV2CommandBridgeV1,
  type AuthenticatedDeclarativeV2CommandBridgeV1Failure,
  type AuthenticatedDeclarativeV2CommandSessionV1,
  type AuthenticatedDeclarativeV2CommandSettlementInputV1,
  type AuthenticatedDeclarativeV2CommandWorkV1,
  type DeclarativeV2VerifierProgressEvidencePageSnapshotV2,
  type DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  type DeclarativeV2VerifierProgressSettlementSnapshotV2,
} from "@flarex/persistence-postgres/internal/system-test/authenticated-declarative-v2-command-bridge-v1";
/*
 * The import above is deliberately the analyzer app's narrow private
 * persistence surface. It does not expose repository Run/Work/transaction
 * authority to callers of this module.
 */
import type {
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierCommandOutputManifestFrameV2,
  DeclarativeV2VerifierCommandReceiptFrameV2,
  DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { Data, Effect, Scope } from "effect";

import type {
  PrivateDeclarativeV2AnalyzerHostV1,
  PrivateDeclarativeV2AnalyzerHostV1Error,
  PrivateDeclarativeV2AnalyzerSessionV1,
} from "./DeclarativeV2AnalyzerPort";

export interface PrivateDeclarativeV2PersistedRestartEvidenceV1 {
  readonly terminal: Extract<
    DeclarativeV2VerifierRestartProducerStepV1,
    { readonly status: "complete" }
  >;
  readonly pageCount: bigint;
}

export interface PrivateDeclarativeV2SettledRestartEvidenceV1 {
  readonly settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2;
  readonly pages:
    ReadonlyArray<DeclarativeV2VerifierProgressEvidencePageSnapshotV2>;
}

export class PrivateDeclarativeV2AnalyzerRestartPlanV1Error
  extends Data.TaggedError(
    "PrivateDeclarativeV2AnalyzerRestartPlanV1Error",
  )<{
    readonly operation: "loadSettledEvidence";
    readonly reason: "budgetExceeded";
    readonly dimension:
      | "calls"
      | "rows"
      | "frameBytes"
      | "canonicalBytes"
      | "hashBytes"
      | "elapsedMilliseconds"
      | "pages"
      | "payloadBytes";
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

type PrivateDeclarativeV2SettledEvidenceBatchV1 =
  Effect.Success<
    ReturnType<
      AuthenticatedDeclarativeV2CommandBridgeV1<
        never
      >["readSettledEvidencePageBatch"]
    >
  >;

export type PrivateDeclarativeV2RestartEvidenceAppendPortV1 =
  Pick<
    AuthenticatedDeclarativeV2CommandBridgeV1<never>,
    "appendEvidencePage"
  >;

export type PrivateDeclarativeV2CommandSettlementPortV1 =
  Pick<
    AuthenticatedDeclarativeV2CommandBridgeV1<never>,
    "settle"
  >;

export type PrivateDeclarativeV2SettledEvidenceReadPortV1 =
  Pick<
    AuthenticatedDeclarativeV2CommandBridgeV1<never>,
    "readSettledEvidencePageBatch"
  >;

type PrivateDeclarativeV2RestartEvidenceHostPortV1 =
  Pick<
    PrivateDeclarativeV2AnalyzerHostV1,
    "openRestartEvidence" | "stepRestartEvidence"
  >;

type PrivateDeclarativeV2TerminalHostPortV1 =
  Pick<PrivateDeclarativeV2AnalyzerHostV1, "claimTerminal">;

type PrivateDeclarativeV2RehydrateHostPortV1 =
  Pick<PrivateDeclarativeV2AnalyzerHostV1, "rehydrate">;

export interface PrivateDeclarativeV2AuthenticatedRestartSourcePortV1<
  Failure,
  Requirements,
> {
  readonly authenticate: (
    evidence: PrivateDeclarativeV2SettledRestartEvidenceV1,
  ) => Effect.Effect<
    Readonly<{
      readonly factory:
        DeclarativeV2AuthenticatedCommandRestartInputFactoryV1;
      readonly source:
        DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1;
    }>,
    Failure,
    Requirements | Scope.Scope
  >;
}

export interface PersistPrivateDeclarativeV2RestartEvidenceInputV1 {
  readonly host: PrivateDeclarativeV2RestartEvidenceHostPortV1;
  readonly session: PrivateDeclarativeV2AnalyzerSessionV1;
  readonly result: DeclarativeV2AnalyzerCompleteV1;
  readonly claim: DeclarativeV2AnalyzerRestartEvidenceClaimV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly allowance: number;
  readonly bridge: PrivateDeclarativeV2RestartEvidenceAppendPortV1;
  readonly work: AuthenticatedDeclarativeV2CommandWorkV1;
  readonly pageBudget:
    DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2;
}

export const persistPrivateDeclarativeV2RestartEvidenceV1: (
  input: Readonly<
    PersistPrivateDeclarativeV2RestartEvidenceInputV1
  >,
) => Effect.Effect<
  PrivateDeclarativeV2PersistedRestartEvidenceV1,
  | PrivateDeclarativeV2AnalyzerHostV1Error
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure,
  Scope.Scope
> = Effect.fn(
  "PrivateDeclarativeV2AnalyzerRestartPlan.persistEvidence",
)(function* (
  input: Readonly<
    PersistPrivateDeclarativeV2RestartEvidenceInputV1
  >,
): Effect.fn.Return<
  PrivateDeclarativeV2PersistedRestartEvidenceV1,
  | PrivateDeclarativeV2AnalyzerHostV1Error
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure,
  Scope.Scope
> {
  const producer = yield* input.host.openRestartEvidence({
    session: input.session,
    result: input.result,
    claim: input.claim,
    maximum: input.maximum,
  });
  let pageCount = 0n;
  for (;;) {
    const stepped = yield* input.host.stepRestartEvidence(
      producer,
      input.allowance,
    );
    if (stepped.status === "page") {
      yield* retryOnceOnConfirmedRollback(() =>
        input.bridge.appendEvidencePage(
          input.work,
          {
            manifestBytes: stepped.page.manifestBytes,
            payloadBytes: stepped.page.payloadBytes,
          },
          input.pageBudget,
        )
      );
      pageCount += 1n;
    } else if (stepped.status === "complete") {
      return Object.freeze({ terminal: stepped, pageCount });
    }
    yield* Effect.yieldNow;
  }
});

export interface SettlePrivateDeclarativeV2AnalyzerCommandInputV1 {
  readonly host: PrivateDeclarativeV2TerminalHostPortV1;
  readonly bridge: PrivateDeclarativeV2CommandSettlementPortV1;
  readonly work: AuthenticatedDeclarativeV2CommandWorkV1;
  readonly result: DeclarativeV2AnalyzerCompleteV1;
  readonly requestSha256: Uint8Array;
  readonly outputManifest:
    DeclarativeV2VerifierCommandOutputManifestFrameV2;
  readonly commandUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly receipt: DeclarativeV2VerifierCommandReceiptFrameV2;
  readonly operationBudget:
    DeclarativeV2VerifierProgressRepositoryOperationBudgetV2;
}

export const settlePrivateDeclarativeV2AnalyzerCommandV1: (
  input: Readonly<
    SettlePrivateDeclarativeV2AnalyzerCommandInputV1
  >,
) => Effect.Effect<
  DeclarativeV2VerifierProgressSettlementSnapshotV2,
  | PrivateDeclarativeV2AnalyzerHostV1Error
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure
> = Effect.fn(
  "PrivateDeclarativeV2AnalyzerRestartPlan.settleCommand",
)(function* (
  input: Readonly<
    SettlePrivateDeclarativeV2AnalyzerCommandInputV1
  >,
): Effect.fn.Return<
  DeclarativeV2VerifierProgressSettlementSnapshotV2,
  | PrivateDeclarativeV2AnalyzerHostV1Error
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure
> {
  const terminalProof = yield* input.host.claimTerminal({
    result: input.result,
    requestSha256: input.requestSha256,
    outputManifest: input.outputManifest,
    commandUsage: input.commandUsage,
    resultingUsage: input.resultingUsage,
    nextProgress: input.nextProgress,
    receipt: input.receipt,
  });
  const settlementInput = Object.freeze({
    outputManifest: input.outputManifest,
    commandUsage: input.commandUsage,
    resultingUsage: input.resultingUsage,
    nextProgress: input.nextProgress,
    receipt: input.receipt,
    terminalProofBytes: terminalProof.canonicalBytes,
  }) satisfies AuthenticatedDeclarativeV2CommandSettlementInputV1;
  return (yield* retryOnceOnConfirmedRollback(() =>
    input.bridge.settle(
      input.work,
      settlementInput,
      input.operationBudget,
    )
  )).settlement;
});

export interface LoadPrivateDeclarativeV2SettledRestartEvidenceInputV1 {
  readonly bridge: PrivateDeclarativeV2SettledEvidenceReadPortV1;
  readonly session: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly commandKind: "parse_module" | "link_page";
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly outputManifestSha256: Uint8Array;
  readonly receiptSha256: Uint8Array;
  readonly pageBudget:
    DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2;
}

export const loadPrivateDeclarativeV2SettledRestartEvidenceV1: (
  input: Readonly<
    LoadPrivateDeclarativeV2SettledRestartEvidenceInputV1
  >,
) => Effect.Effect<
  PrivateDeclarativeV2SettledRestartEvidenceV1,
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure
  | PrivateDeclarativeV2AnalyzerRestartPlanV1Error
> = Effect.fn(
  "PrivateDeclarativeV2AnalyzerRestartPlan.loadSettledEvidence",
)(function* (
  input: Readonly<
    LoadPrivateDeclarativeV2SettledRestartEvidenceInputV1
  >,
): Effect.fn.Return<
  PrivateDeclarativeV2SettledRestartEvidenceV1,
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure
  | PrivateDeclarativeV2AnalyzerRestartPlanV1Error
> {
  const pages: DeclarativeV2VerifierProgressEvidencePageSnapshotV2[] = [];
  let startPageOrdinal = 0n;
  let expectedPredecessorPageSha256: Uint8Array | null = null;
  const usage = mutableSettledEvidenceUsage();
  let settlement:
    | DeclarativeV2VerifierProgressSettlementSnapshotV2
    | undefined;
  for (;;) {
    const remainingBudget = yield* remainingSettledEvidenceBudget(
      input.pageBudget,
      usage,
    );
    const batch:
      PrivateDeclarativeV2SettledEvidenceBatchV1 =
        yield* input.bridge.readSettledEvidencePageBatch(
      input.session,
      {
        commandKind: input.commandKind,
        sequence: input.sequence,
        reservationSha256: input.reservationSha256,
        outputManifestSha256: input.outputManifestSha256,
        receiptSha256: input.receiptSha256,
        startPageOrdinal,
        expectedPredecessorPageSha256,
      },
        remainingBudget,
    );
    yield* addSettledEvidenceUsage(
      input.pageBudget,
      usage,
      batch.operationUsage,
    );
    settlement ??= batch.settlement;
    pages.push(...batch.pages);
    if (batch.next === null) {
      if (settlement === undefined) {
        throw new Error(
          "Authenticated settled-evidence read omitted its settlement.",
        );
      }
      return Object.freeze({
        settlement,
        pages: Object.freeze(pages),
      });
    }
    startPageOrdinal = batch.next.startPageOrdinal;
    expectedPredecessorPageSha256 =
      batch.next.expectedPredecessorPageSha256;
    yield* Effect.yieldNow;
  }
});

export interface LoadAndRehydratePrivateDeclarativeV2AnalyzerInputV1<
  SourceFailure,
  Requirements,
> extends Omit<
  LoadPrivateDeclarativeV2SettledRestartEvidenceInputV1,
  "session"
> {
  readonly host: PrivateDeclarativeV2RehydrateHostPortV1;
  readonly analyzerSession: PrivateDeclarativeV2AnalyzerSessionV1;
  readonly persistenceSession: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly source:
    PrivateDeclarativeV2AuthenticatedRestartSourcePortV1<
      SourceFailure,
      Requirements
    >;
  readonly allowance: number;
}

export const loadAndRehydratePrivateDeclarativeV2AnalyzerV1: <
  SourceFailure,
  Requirements,
>(
  input: Readonly<
    LoadAndRehydratePrivateDeclarativeV2AnalyzerInputV1<
      SourceFailure,
      Requirements
    >
  >,
) => Effect.Effect<
  DeclarativeV2AnalyzerCompleteV1,
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure
  | PrivateDeclarativeV2AnalyzerRestartPlanV1Error
  | SourceFailure
  | PrivateDeclarativeV2AnalyzerHostV1Error,
  Requirements | Scope.Scope
> = Effect.fn(
  "PrivateDeclarativeV2AnalyzerRestartPlan.loadAndRehydrate",
)(function* <SourceFailure, Requirements>(
  input: Readonly<
    LoadAndRehydratePrivateDeclarativeV2AnalyzerInputV1<
      SourceFailure,
      Requirements
    >
  >,
): Effect.fn.Return<
  DeclarativeV2AnalyzerCompleteV1,
  | AuthenticatedDeclarativeV2CommandBridgeV1Failure
  | PrivateDeclarativeV2AnalyzerRestartPlanV1Error
  | SourceFailure
  | PrivateDeclarativeV2AnalyzerHostV1Error,
  Requirements | Scope.Scope
> {
  const evidence = yield* loadPrivateDeclarativeV2SettledRestartEvidenceV1({
    bridge: input.bridge,
    session: input.persistenceSession,
    commandKind: input.commandKind,
    sequence: input.sequence,
    reservationSha256: input.reservationSha256,
    outputManifestSha256: input.outputManifestSha256,
    receiptSha256: input.receiptSha256,
    pageBudget: input.pageBudget,
  });
  const authenticated = yield* input.source.authenticate(evidence);
  return yield* input.host.rehydrate({
    session: input.analyzerSession,
    restartFactory: authenticated.factory,
    source: authenticated.source,
    allowance: input.allowance,
  });
});

function retryOnceOnConfirmedRollback<A>(
  operation: () => Effect.Effect<
    A,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >,
): Effect.Effect<
  A,
  AuthenticatedDeclarativeV2CommandBridgeV1Failure,
  never
> {
  return operation().pipe(Effect.catchTag(
    "DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error",
    (
      error: DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error,
    ) =>
      error.retryable
      ? operation()
      : Effect.fail(error),
  ));
}

function enforceSettledEvidenceBudget(
  dimension: PrivateDeclarativeV2AnalyzerRestartPlanV1Error["dimension"],
  observed: bigint,
  maximum: bigint,
): Effect.Effect<
  void,
  PrivateDeclarativeV2AnalyzerRestartPlanV1Error
> {
  return observed <= maximum
    ? Effect.void
    : Effect.fail(new PrivateDeclarativeV2AnalyzerRestartPlanV1Error({
      operation: "loadSettledEvidence",
      reason: "budgetExceeded",
      dimension,
      observed,
      maximum,
    }));
}

interface MutableSettledEvidenceUsageV1 {
  calls: number;
  rows: number;
  frameBytes: number;
  canonicalBytes: number;
  hashBytes: number;
  elapsedMilliseconds: number;
  pages: number;
  payloadBytes: number;
}

type SettledEvidenceUsageDimensionV1 =
  keyof MutableSettledEvidenceUsageV1;

const SETTLED_EVIDENCE_USAGE_DIMENSIONS_V1 = Object.freeze([
  "calls",
  "rows",
  "frameBytes",
  "canonicalBytes",
  "hashBytes",
  "elapsedMilliseconds",
  "pages",
  "payloadBytes",
] as const satisfies ReadonlyArray<SettledEvidenceUsageDimensionV1>);

const REQUIRED_NEXT_PAGE_USAGE_DIMENSIONS_V1 = Object.freeze([
  "calls",
  "rows",
  "frameBytes",
  "canonicalBytes",
  "hashBytes",
  "pages",
  "payloadBytes",
] as const satisfies ReadonlyArray<SettledEvidenceUsageDimensionV1>);

function mutableSettledEvidenceUsage(): MutableSettledEvidenceUsageV1 {
  return {
    calls: 0,
    rows: 0,
    frameBytes: 0,
    canonicalBytes: 0,
    hashBytes: 0,
    elapsedMilliseconds: 0,
    pages: 0,
    payloadBytes: 0,
  };
}

function maximumForSettledEvidenceDimension(
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  dimension: SettledEvidenceUsageDimensionV1,
): number {
  switch (dimension) {
    case "calls":
      return budget.maximumCalls;
    case "rows":
      return budget.maximumRows;
    case "frameBytes":
      return budget.maximumFrameBytes;
    case "canonicalBytes":
      return budget.maximumCanonicalBytes;
    case "hashBytes":
      return budget.maximumHashBytes;
    case "elapsedMilliseconds":
      return budget.maximumElapsedMilliseconds;
    case "pages":
      return budget.maximumPages;
    case "payloadBytes":
      return budget.maximumPayloadBytes;
  }
}

function remainingSettledEvidenceBudget(
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutableSettledEvidenceUsageV1,
): Effect.Effect<
  DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  PrivateDeclarativeV2AnalyzerRestartPlanV1Error
> {
  return Effect.gen(function* () {
    for (const dimension of REQUIRED_NEXT_PAGE_USAGE_DIMENSIONS_V1) {
      const maximum = maximumForSettledEvidenceDimension(
        budget,
        dimension,
      );
      if (usage[dimension] >= maximum) {
        return yield* Effect.fail(settledEvidenceBudgetError(
          dimension,
          BigInt(usage[dimension]) + 1n,
          BigInt(maximum),
        ));
      }
    }
    return Object.freeze({
      maximumCalls: budget.maximumCalls - usage.calls,
      maximumRows: budget.maximumRows - usage.rows,
      maximumFrameBytes:
        budget.maximumFrameBytes - usage.frameBytes,
      maximumCanonicalBytes:
        budget.maximumCanonicalBytes - usage.canonicalBytes,
      maximumHashBytes:
        budget.maximumHashBytes - usage.hashBytes,
      maximumElapsedMilliseconds:
        budget.maximumElapsedMilliseconds - usage.elapsedMilliseconds,
      maximumPages: budget.maximumPages - usage.pages,
      maximumPayloadBytes:
        budget.maximumPayloadBytes - usage.payloadBytes,
    });
  });
}

function addSettledEvidenceUsage(
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  aggregate: MutableSettledEvidenceUsageV1,
  batch: Readonly<MutableSettledEvidenceUsageV1>,
): Effect.Effect<
  void,
  PrivateDeclarativeV2AnalyzerRestartPlanV1Error
> {
  return Effect.gen(function* () {
    for (const dimension of SETTLED_EVIDENCE_USAGE_DIMENSIONS_V1) {
      const maximum = maximumForSettledEvidenceDimension(
        budget,
        dimension,
      );
      const observed = aggregate[dimension] + batch[dimension];
      yield* enforceSettledEvidenceBudget(
        dimension,
        BigInt(observed),
        BigInt(maximum),
      );
      aggregate[dimension] = observed;
    }
  });
}

function settledEvidenceBudgetError(
  dimension: PrivateDeclarativeV2AnalyzerRestartPlanV1Error["dimension"],
  observed: bigint,
  maximum: bigint,
): PrivateDeclarativeV2AnalyzerRestartPlanV1Error {
  return new PrivateDeclarativeV2AnalyzerRestartPlanV1Error({
    operation: "loadSettledEvidence",
    reason: "budgetExceeded",
    dimension,
    observed,
    maximum,
  });
}
