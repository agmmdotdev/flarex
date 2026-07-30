import type {
  DeclarativeV2AnalyzerCompleteV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import type {
  DeclarativeV2AuthenticatedCommandDecodedCapabilityV1,
  DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
  DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-v1";
import type {
  DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-restart-input-v1";
import {
  type AuthenticatedVerifiedStandardApplicationAnalysisV1,
  type StandardApplicationAnalysisContextV1,
} from "@flarex/standard-application-analysis/v1";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Data, Effect, Result, Scope } from "effect";

import {
  type PrivateDeclarativeV2AnalyzerHostV1,
  PrivateDeclarativeV2AnalyzerHostV1Error,
} from "./DeclarativeV2AnalyzerPort";

export interface PrivateStandardApplicationAnalysisExecuteStepV1 {
  readonly kind: "execute";
  readonly commandFactory:
    DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1;
  readonly capability: DeclarativeV2AuthenticatedCommandDecodedCapabilityV1;
  readonly transportBudget:
    DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
  readonly allowance: number;
}

export interface PrivateStandardApplicationAnalysisRehydrateStepV1 {
  readonly kind: "rehydrate";
  readonly restartFactory:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1;
  readonly source:
    DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1;
  readonly allowance: number;
}

export type PrivateStandardApplicationAnalysisStepV1 =
  | PrivateStandardApplicationAnalysisExecuteStepV1
  | PrivateStandardApplicationAnalysisRehydrateStepV1;

/**
 * One process-local analyzer program. Its steps contain the accepted host's
 * opaque, single-use capabilities and must never be serialized or persisted.
 */
export interface PrivateStandardApplicationAnalysisPlanV1 {
  readonly sessionAuthority: unknown;
  readonly steps: ReadonlyArray<PrivateStandardApplicationAnalysisStepV1>;
}

export type PrivateStandardApplicationAnalysisPlanFactoryV1<
  Failure,
  Requirements = never,
> = (
  preparedDefinition: PreparedStandardApplicationDefinitionV1,
) => Effect.Effect<
  PrivateStandardApplicationAnalysisPlanV1,
  Failure,
  Requirements
>;

export class PrivateStandardApplicationAnalysisV1Error
  extends Data.TaggedError("PrivateStandardApplicationAnalysisV1Error")<{
    readonly operation: "analyze";
    readonly reason: "emptyPlan" | "unexpectedTerminalResult";
    readonly path: "steps" | "terminal.kind";
    readonly observedKind?: DeclarativeV2AnalyzerCompleteV1["kind"];
  }> {}

export type PrivateStandardApplicationAnalysisFailureV1<PlanFailure> =
  | PlanFailure
  | PrivateDeclarativeV2AnalyzerHostV1Error
  | PrivateStandardApplicationAnalysisV1Error;

/**
 * Adapts a request-owned authenticated command plan to the accepted private
 * analyzer host. The adapter sequences only existing host inputs; the host
 * remains the sole verifier implementation and lifecycle owner.
 */
export function makePrivateStandardApplicationAnalysisContextV1<
  PlanFailure,
  PlanRequirements = never,
>(options: Readonly<{
  readonly host: PrivateDeclarativeV2AnalyzerHostV1;
  readonly plan:
    PrivateStandardApplicationAnalysisPlanFactoryV1<
      PlanFailure,
      PlanRequirements
    >;
}>): StandardApplicationAnalysisContextV1<
  PrivateStandardApplicationAnalysisFailureV1<PlanFailure>,
  PlanRequirements | Scope.Scope
> {
  const analyze = Effect.fn(
    "PrivateStandardApplicationAnalysisV1.analyze",
  )(function* (
    preparedDefinition: PreparedStandardApplicationDefinitionV1,
  ): Effect.fn.Return<
    AuthenticatedVerifiedStandardApplicationAnalysisV1,
    PrivateStandardApplicationAnalysisFailureV1<PlanFailure>,
    PlanRequirements | Scope.Scope
  > {
    const plan = yield* options.plan(preparedDefinition);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const unexpectedFailures: unknown[] = [];
        for (const step of plan.steps) {
          if (step.kind === "execute") {
            const closed = step.commandFactory.close(step.capability);
            if (
              Result.isFailure(closed) &&
              closed.failure.reason !== "closed"
            ) {
              unexpectedFailures.push(closed.failure);
            }
          } else {
            const closed = step.restartFactory.close(step.source);
            if (
              Result.isFailure(closed) &&
              closed.failure.reason !== "closed"
            ) {
              unexpectedFailures.push(closed.failure);
            }
          }
        }
        if (unexpectedFailures.length > 0) {
          throw new AggregateError(
            unexpectedFailures,
            "Private Standard analysis plan cleanup failed.",
          );
        }
      })
    );
    if (plan.steps.length === 0) {
      return yield* Effect.fail(
        new PrivateStandardApplicationAnalysisV1Error({
          operation: "analyze",
          reason: "emptyPlan",
          path: "steps",
        }),
      );
    }

    const session = yield* options.host.open(plan.sessionAuthority);
    let terminal: DeclarativeV2AnalyzerCompleteV1 | undefined;
    for (const step of plan.steps) {
      terminal = step.kind === "execute"
        ? yield* options.host.execute({
            session,
            commandFactory: step.commandFactory,
            capability: step.capability,
            transportBudget: step.transportBudget,
            allowance: step.allowance,
          })
        : yield* options.host.rehydrate({
            session,
            restartFactory: step.restartFactory,
            source: step.source,
            allowance: step.allowance,
          });
    }

    if (terminal?.kind !== "registration_page") {
      return yield* Effect.fail(
        new PrivateStandardApplicationAnalysisV1Error({
          operation: "analyze",
          reason: "unexpectedTerminalResult",
          path: "terminal.kind",
          ...(terminal === undefined
            ? {}
            : { observedKind: terminal.kind }),
        }),
      );
    }
    return terminal;
  });

  return Object.freeze({ analyze });
}
