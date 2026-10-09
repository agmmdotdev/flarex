import { Effect, Option } from "effect";
import { prepareFrameworkMigrationDefinition } from "./definition";
import type { RelationalMigrationPlan } from "./model";
import { readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect } from "./migrationCollisionHeadRepository";
import { verifyFrameworkMigrationReceiptInventoryInTransactionEffect } from "./migrationStepReceiptRepository";
import { verifyRelationalStructuralPrefixEffect } from "./relationalStructuralRunner";
import { FrameworkMigrationRepositoryError } from "./repositoryErrors";
import { restoredFrameworkMigrationCollisionHeadAuthority,
  type RestoredFrameworkMigrationCollisionHead } from "./storedEventRestoration";
import type { RestoredFrameworkMigrationStepReceipt } from "./storedRestoration";
import { readFrameworkMigrationCollisionDomainInTransactionEffect,
  readFrameworkSchemaTargetNamespaceInTransactionEffect } from "./targetCollisionRepository";
import { runFrameworkMigrationTargetTransactionEffect, withFrameworkMigrationRawTransactionEffect,
  type FrameworkMigrationTarget, type FrameworkMigrationTransactionBudget } from "./targetSession";
import { withFrameworkGraphReadPass } from "./graphReadPass";
import { withFrameworkMigrationPlanVerification } from "./planVerificationScope";

/** A diagnostic snapshot, never readiness, activation, a lease or permission to
 * skip future checks. Verification writes no metadata and performs no DDL. */
export type FrameworkMigrationVerificationReport =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "verified"; planSha256: string; completedStepCount: number;
      requiredStepCount: number; complete: boolean }>;

/** Source-private explicit full audit. The installer facade will own caller
 * construction; ordinary progress is not silently redirected through this API. */
export const verifyFrameworkMigrationEffect = Effect.fn("FrameworkMigration.verify")(
  function* (target: FrameworkMigrationTarget, plan: RelationalMigrationPlan,
    budget: FrameworkMigrationTransactionBudget) {
    const definition = yield* prepareFrameworkMigrationDefinition(target, plan);
    return yield* runFrameworkMigrationTargetTransactionEffect(target, { kind: "ordinary",
      lockTimeoutMilliseconds: budget.lockTimeoutMilliseconds,
      statementTimeoutMilliseconds: budget.statementTimeoutMilliseconds },
      transaction => withFrameworkMigrationRawTransactionEffect(transaction, target, raw =>
        withFrameworkGraphReadPass(Effect.gen(function* () {
          const namespace = yield* readFrameworkSchemaTargetNamespaceInTransactionEffect(raw, plan.targetNamespace);
          if (Option.isNone(namespace)) return Object.freeze({ kind: "absent" as const });
          const collision = yield* readFrameworkMigrationCollisionDomainInTransactionEffect(raw, namespace.value, plan.frame.collision);
          if (Option.isNone(collision)) return Object.freeze({ kind: "absent" as const });
          const selected = yield* readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(raw, collision.value);
          if (Option.isNone(selected)) return Object.freeze({ kind: "absent" as const });
          const head = selected.value;
          if (head.plan.plan.migrationPlanSha256 !== plan.migrationPlanSha256 || head.plan.plan.canonicalJson !== plan.canonicalJson) {
            return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal("readCollisionHead"));
          }
          // Head restoration already authenticated the event-linked ordered
          // prefix, including original producers across no-work successors.
          const graph = restoredFrameworkMigrationCollisionHeadAuthority(head);
          if (graph === undefined) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption("readCollisionHead"));
          const receipts = graph.receipts;
          yield* verifyFrameworkMigrationReceiptProgress(head, receipts);
          yield* verifyFrameworkMigrationReceiptInventoryInTransactionEffect(raw, head.plan, receipts);
          yield* verifyRelationalStructuralPrefixEffect(definition.runner, transaction, receipts.length);
          return Object.freeze({ kind: "verified" as const, planSha256: plan.migrationPlanSha256,
            completedStepCount: receipts.length, requiredStepCount: plan.frame.steps.length,
            complete: receipts.length === plan.frame.steps.length });
        }), raw)),
    );
  }, withFrameworkMigrationPlanVerification,
);

/** Exact projected progress corroboration shared by live claims and full audits. */
export const verifyFrameworkMigrationReceiptProgress = Effect.fn("FrameworkMigration.verifyReceiptProgress")(
  function* (head: RestoredFrameworkMigrationCollisionHead, receipts: readonly RestoredFrameworkMigrationStepReceipt[]) {
    if (receipts.length !== head.progress.completedStepCount ||
      (receipts.at(-1)?.storageId ?? null) !== (head.progress.lastReceipt?.storageId ?? null)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption("readCollisionHead"));
    }
  },
);
