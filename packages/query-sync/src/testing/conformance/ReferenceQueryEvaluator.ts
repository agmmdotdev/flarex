import { Effect, Ref } from "effect";

import type { QueryEvaluationAttempt } from "../../kernel/Model.js";
import type {
  EvaluationCallBudget,
  QueryEvaluator,
} from "../../orchestration/Ports.js";

export interface ReferenceQueryEvaluatorCall {
  readonly attempt: QueryEvaluationAttempt;
  readonly budget: EvaluationCallBudget;
}

export type ReferenceQueryEvaluatorStep = (
  call: ReferenceQueryEvaluatorCall,
) => ReturnType<QueryEvaluator["evaluate"]>;

export interface ReferenceQueryEvaluator extends QueryEvaluator {
  readonly snapshotForConformance: () => Effect.Effect<
    readonly ReferenceQueryEvaluatorCall[],
    never,
    never
  >;
}

interface ReferenceQueryEvaluatorState {
  readonly nextStepIndex: number;
  readonly calls: readonly ReferenceQueryEvaluatorCall[];
}

function captureBudget(budget: EvaluationCallBudget): EvaluationCallBudget {
  return Object.freeze({
    remainingEvaluatorCallsIncludingThisCall:
      budget.remainingEvaluatorCallsIncludingThisCall,
    maximumSettlementMilliseconds: budget.maximumSettlementMilliseconds,
  });
}

export interface MakeReferenceQueryEvaluator {
  (
    steps: readonly ReferenceQueryEvaluatorStep[],
  ): Effect.Effect<ReferenceQueryEvaluator, never, never>;
}

export const makeReferenceQueryEvaluator: MakeReferenceQueryEvaluator =
  Effect.fn("QuerySync.ReferenceQueryEvaluator.make")(
    function*(stepsInput): Effect.fn.Return<ReferenceQueryEvaluator> {
      const steps = Object.freeze([...stepsInput]);
      const stateRef = yield* Ref.make<ReferenceQueryEvaluatorState>({
        nextStepIndex: 0,
        calls: Object.freeze([]),
      });

      const evaluate: QueryEvaluator["evaluate"] = Effect.fn(
        "QuerySync.ReferenceQueryEvaluator.evaluate",
      )(function*(attempt, budget) {
        const call: ReferenceQueryEvaluatorCall = Object.freeze({
          attempt,
          budget: captureBudget(budget),
        });
        const step = yield* Ref.modify(stateRef, (state) => {
          const selected = steps[state.nextStepIndex];
          return [
            selected,
            {
              nextStepIndex: state.nextStepIndex + 1,
              calls: Object.freeze([...state.calls, call]),
            },
          ];
        });
        if (step === undefined) {
          return yield* Effect.die(
            "Reference query evaluator script exhausted",
          );
        }
        return yield* step(call);
      });

      const snapshotForConformance = Effect.fn(
        "QuerySync.ReferenceQueryEvaluator.snapshotForConformance",
      )(function*(): Effect.fn.Return<
        readonly ReferenceQueryEvaluatorCall[]
      > {
        const state = yield* Ref.get(stateRef);
        return Object.freeze([...state.calls]);
      });

      return Object.freeze({ evaluate, snapshotForConformance });
    },
  );
