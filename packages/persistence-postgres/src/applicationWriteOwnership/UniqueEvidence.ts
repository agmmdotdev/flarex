import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { FlarexMetadataDatabase } from "../deployments";
import { readAppUniqueConstraintSetClosureV1Effect, type ReadAppUniqueConstraintSetClosureV1Error } from "../appUniqueConstraintSetClosureV1";
import { fxControlSchemaVersionUniqueConstraintBindings as bindings, fxControlUniqueConstraintDefinitions as definitions } from "../schema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { ApplicationWriteOwnershipError } from "./Model";
import type { ApplicationWriteOwnershipHistoryBudget } from "./Policy";

const projectFailure = (cause: ReadAppUniqueConstraintSetClosureV1Error) => new ApplicationWriteOwnershipError({
  reason: cause._tag === "AppUniqueConstraintSetClosurePersistenceV1Error" || cause._tag === "AppUniqueConstraintCatalogPersistenceError" ? "resourceFailure" : "invalidEvidence", cause,
});

/** Closed catalog sets are immutable. Reserve each binding/definition before restoring its payload. */
export const readOwnershipUniqueClosure = Effect.fn("ApplicationWriteOwnership.readUniqueClosure")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId, budget: ApplicationWriteOwnershipHistoryBudget,
) {
  const sizes = yield* runDrizzleStatementEffect(db.select({
    length: sql<number>`octet_length(${definitions.physicalSpecBytes}) + octet_length(${definitions.physicalSpecJson}::text)`,
  }).from(bindings).innerJoin(definitions, and(eq(definitions.deploymentId, bindings.deploymentId),
    eq(definitions.uniqueConstraintDefinitionId, bindings.uniqueConstraintDefinitionId),
    eq(definitions.logicalUniqueConstraintId, bindings.logicalUniqueConstraintId)))
    .where(and(eq(bindings.deploymentId, deploymentId), eq(bindings.schemaVersionId, schemaVersionId))).limit(65),
  cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }));
  // One closure, plus the definition and binding per member; fixed fields have a conservative byte allowance.
  yield* Effect.fromResult(budget.consume(1 + sizes.length * 2, 512 + sizes.reduce((bytes, row) => bytes + row.length + 512, 0)));
  const closure = yield* readAppUniqueConstraintSetClosureV1Effect(db, deploymentId, schemaVersionId, sizes.length).pipe(Effect.mapError(projectFailure));
  if (closure === null || closure.members.length !== sizes.length) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
  return closure;
});
