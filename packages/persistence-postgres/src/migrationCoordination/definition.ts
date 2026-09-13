import { Effect } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { capturedStepForPlan } from "./authority";
import type { FrameworkMigrationStep, RelationalMigrationPlan } from "./model";
import { issueRelationalStructuralRunnerTokenEffect,
  type RelationalStructuralRunnerToken } from "./relationalStructuralRunner";
import type { FrameworkMigrationTarget } from "./targetSession";

/** Immutable execution values only. No stored rows, live lease, session, or
 * committed-progress authority is retained in this prepared definition. */
export interface PreparedFrameworkMigrationDefinition {
  readonly plan: RelationalMigrationPlan;
  readonly runner: RelationalStructuralRunnerToken;
  readonly steps: readonly Readonly<{
    readonly step: FrameworkMigrationStep;
    readonly dependencyOrdinals: readonly number[];
  }>[];
}

export const prepareFrameworkMigrationDefinition = Effect.fn("FrameworkMigrationDefinition.prepare")(
  function* (target: FrameworkMigrationTarget, plan: RelationalMigrationPlan) {
    // Issuance authenticates the captured plan/target and resolves every fixed
    // structural handler. It is the existing authority owner for this work.
    const runner = yield* issueRelationalStructuralRunnerTokenEffect(target, plan);
    const steps = plan.frame.steps.map(step => Object.freeze({ step,
      dependencyOrdinals: Object.freeze(step.dependencies.toSorted((left, right) =>
        compareUtf16Strings(left.stepId, right.stepId)).map(reference => {
        const ordinal = capturedStepForPlan(plan, reference.stepId)?.ordinal;
        // An issued plan has already established an ordered dependency graph.
        if (ordinal === undefined || ordinal >= step.ordinal) throw new Error("Captured migration dependency invariant failed");
        return ordinal;
      })),
    }));
    return Object.freeze({ plan, runner, steps: Object.freeze(steps) } satisfies PreparedFrameworkMigrationDefinition);
  },
);
