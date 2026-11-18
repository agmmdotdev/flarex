import { Effect, Option } from "effect";
import type { RelationalMigrationPlan } from "./model";
import { inspectFrameworkMigrationProgressInTransactionEffect, type FrameworkMigrationProgressSnapshot } from "./migrationCollisionHeadRepository";
import { readFrameworkSchemaTargetNamespaceInTransactionEffect, readFrameworkMigrationCollisionDomainInTransactionEffect } from "./targetCollisionRepository";
import { runFrameworkMigrationTargetTransactionEffect, withFrameworkMigrationRawTransactionEffect,
  type FrameworkMigrationTarget, type FrameworkMigrationTransactionBudget } from "./targetSession";
import { ordinaryRequest } from "./coordinatorJournal";
import { authenticateRelationalMigrationTargetPlanEffect } from "./relationalStructuralRunner";

export type FrameworkMigrationInspectionReport = Readonly<{ kind: "absent" }> | FrameworkMigrationProgressSnapshot;

/** A point-in-time diagnostic. It does not walk event/receipt history, inspect
 * the catalog, hold a lease or issue installation/readiness authority. */
export const inspectFrameworkMigrationEffect = Effect.fn("FrameworkMigration.inspect")(
  function* (target: FrameworkMigrationTarget, plan: RelationalMigrationPlan,
    budget: FrameworkMigrationTransactionBudget) {
    yield* authenticateRelationalMigrationTargetPlanEffect(target, plan, "preflight");
    return yield* runFrameworkMigrationTargetTransactionEffect(target, ordinaryRequest(budget), transaction =>
      withFrameworkMigrationRawTransactionEffect(transaction, target, raw => Effect.gen(function* () {
        const namespace = yield* readFrameworkSchemaTargetNamespaceInTransactionEffect(raw, plan.targetNamespace);
        if (Option.isNone(namespace)) return Object.freeze({ kind: "absent" as const });
        const collision = yield* readFrameworkMigrationCollisionDomainInTransactionEffect(raw, namespace.value, plan.frame.collision);
        if (Option.isNone(collision)) return Object.freeze({ kind: "absent" as const });
        const snapshot = yield* inspectFrameworkMigrationProgressInTransactionEffect(raw, collision.value, plan);
        return Option.isNone(snapshot) ? Object.freeze({ kind: "absent" as const }) : snapshot.value;
      })));
  },
);
