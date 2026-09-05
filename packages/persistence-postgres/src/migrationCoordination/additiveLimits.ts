import { Context, Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { FrameworkMigrationRepositoryError, type FrameworkMigrationRepositoryOperation } from "./repositoryErrors";
import { fxSystemFrameworkMigrationPlans } from "./schema";

/** Execution policy, never evidence or cached database authority. */
export const additiveMigrationGraphLimits = Context.Reference<boolean>("flarex/AdditiveMigrationGraphLimits", {
  defaultValue: () => false,
});

export function withAdditiveMigrationGraphLimits<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
): Effect.Effect<Value, Failure> {
  return effect.pipe(Effect.provideService(additiveMigrationGraphLimits, true));
}

/** Establish policy before any predecessor walk. This lookup grants no stored
 * authority; the aggregate still authenticates every root and reference. */
export const withFrameworkCollisionGraphLimits = Effect.fn("FrameworkMigrationGraphLimits.withCollision")(
  function* <Value>(read: Effect.Effect<Value, FrameworkMigrationRepositoryError>,
    transaction: FlarexMetadataTransaction, collisionStorageId: bigint,
    operation: FrameworkMigrationRepositoryOperation,
  ): Effect.fn.Return<Value, FrameworkMigrationRepositoryError> {
    if (yield* additiveMigrationGraphLimits) return yield* read;
    const plans = yield* runDrizzleStatementEffect(transaction.select({ id: fxSystemFrameworkMigrationPlans.planStorageId })
      .from(fxSystemFrameworkMigrationPlans).where(and(eq(fxSystemFrameworkMigrationPlans.collisionStorageId, collisionStorageId),
        eq(fxSystemFrameworkMigrationPlans.frameVersion, 2))).limit(1),
    cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
    return yield* plans.length === 0 ? read : withAdditiveMigrationGraphLimits(read);
  },
);
