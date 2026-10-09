import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, type Exit } from "effect";
import { expect, vi } from "vitest";
import { CatalogDefinitionNameSchema, type CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { fxControlTables, fxControlIndexDefinitions, fxControlUniqueConstraints, fxControlSchemaVersionUniqueConstraintSets,
  fxControlSchemaVersionUniqueConstraintBindings } from "../../../src/database/schema";
import { prepareSchemaCreationTimeIndexDefinitions, ensureAppCreationTimeIndexDefinitionV1InTransaction } from "../../../src/storage/indexes/appIndexDefinitions";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction } from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { prepareRelationalUniqueDeclarations, ensureRelationalOrderedDefinitions } from "../../../src/storage/catalog/relationalStorageDefinitions";
import {
  findSqlState,
} from "../../../src/commit/point/sqlFailures";
import { ensureLogicalStorageDefinitions, readLogicalStorageRequirements } from "../../../src/storage/catalog/logicalStorageDefinitions";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../../src/storage/indexes/indexBuildReconciliation";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";

/** Shared catalog construction only: candidate metadata still cannot serve. */
export const currencyCatalogWitness = Effect.fn("CurrencyCatalog.witness")(function* (
  persistence: { readonly drizzle: FlarexMetadataDatabase },
  deploymentId: string, schemaVersionId: CatalogSchemaVersionId, tableId: CatalogTableId, concurrent: boolean,
) {
  const prepareIntrinsic = prepareSchemaCreationTimeIndexDefinitions(persistence.drizzle, deploymentId, schemaVersionId);
  const prepareUnique = prepareAppUniqueConstraintDefinitionBindingV1Effect(persistence.drizzle, {
    deploymentId, schemaVersionId, tableId, descriptor: CatalogDefinitionNameSchema.make("key/currency.primary"),
    physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1, orderedFields: ["code"],
      sparse: false, localePolicy: { kind: "none" }, keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
      keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }),
  });
  // A transient provider failure must not become damaged-data evidence. Target
  // each digest boundary independently; real artifact/source verification stays on.
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const nativeRejection = new DOMException("temporary digest-provider failure", "OperationError");
  for (const stage of ["artifact", "source", "uniqueSpec", "intrinsicSpec"] as const) {
    yield* Effect.acquireUseRelease(
      Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, bytes) => {
        const text = new TextDecoder().decode(bytes);
        const selected = stage === "artifact" ? text.startsWith('{"format":"flarexdb-schema-manifest"')
          : stage === "source" ? text.startsWith('{"bindings":')
          : stage === "uniqueSpec" ? text.startsWith('{"format":"flarexdb-app-unique-constraint-physical-spec"')
          : text.startsWith('{"format":"flarexdb-app-index-physical-spec"');
        return selected ? Promise.reject(nativeRejection) : digest(algorithm, bytes);
      })),
      () => Effect.gen(function* () {
        if (stage === "artifact") {
          for (const result of [yield* Effect.result(prepareIntrinsic), yield* Effect.result(prepareUnique),
            yield* Effect.result(readLogicalStorageRequirements(persistence.drizzle, deploymentId, schemaVersionId))]) {
            expect(result).toMatchObject({ _tag: "Failure", failure: {
              _tag: "SchemaVersionArtifactPersistenceError", operation: "readById", cause: nativeRejection,
            } });
          }
          return;
        }
        if (stage === "intrinsicSpec") {
          expect(yield* Effect.result(prepareIntrinsic)).toMatchObject({ _tag: "Failure",
            failure: { _tag: "SchemaCreationTimeIndexPreparationError", reason: "canonicalizationFailed", cause: nativeRejection } });
          expect(yield* Effect.result(loadPublishedPhysicalRequirementSnapshotV1(persistence.drizzle, { deploymentId, schemaVersionId })))
            .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: nativeRejection } });
          return;
        }
        if (stage === "source") {
          expect(yield* Effect.result(prepareIntrinsic)).toMatchObject({ _tag: "Failure",
            failure: { _tag: "SchemaVersionTableBindingsError", reason: "resourceFailure" } });
          expect(yield* Effect.result(readLogicalStorageRequirements(persistence.drizzle, deploymentId, schemaVersionId)))
            .toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalSchemaAdmissionEvidenceError", reason: "resourceFailure" } });
          expect(yield* Effect.result(loadPublishedPhysicalRequirementSnapshotV1(persistence.drizzle, { deploymentId, schemaVersionId })))
            .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure" } });
        }
        expect(yield* Effect.result(prepareUnique)).toMatchObject({ _tag: "Failure",
          failure: { _tag: "AppUniqueConstraintDefinitionPreparationError", operation: stage === "source" ? "readSourceBindings" : "canonicalizeSpec" } });
      }),
      spy => Effect.sync(() => spy.mockRestore()),
    );
    expect((yield* prepareIntrinsic)).toHaveLength(3);
    expect((yield* prepareUnique).tableId).toBe(tableId);
  }
  for (const kind of ["unique", "intrinsic"] as const) {
    for (const fault of ["unexpectedRejection", "invalidDigest"] as const) {
      const rejection = new Error("unexpected spec digest failure");
      yield* Effect.acquireUseRelease(
        Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, bytes) => {
          const prefix = kind === "unique" ? '{"format":"flarexdb-app-unique-constraint-physical-spec"'
            : '{"format":"flarexdb-app-index-physical-spec"';
          if (!new TextDecoder().decode(bytes).startsWith(prefix)) return digest(algorithm, bytes);
          return fault === "unexpectedRejection" ? Promise.reject(rejection) : Promise.resolve(new ArrayBuffer(31));
        })),
        () => Effect.gen(function* () {
          const expectDefect = <Value, Failure>(exit: Exit.Exit<Value, Failure>) => {
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasDies(exit.cause)).toBe(true);
              expect(Cause.hasFails(exit.cause)).toBe(false);
              if (fault === "unexpectedRejection") expect(exit.cause.toString()).toContain(rejection.message);
            }
          };
          if (kind === "unique") expectDefect(yield* Effect.exit(prepareUnique));
          else expectDefect(yield* Effect.exit(prepareIntrinsic));
        }),
        spy => Effect.sync(() => spy.mockRestore()),
      );
      if (kind === "unique") yield* prepareUnique;
      else yield* prepareIntrinsic;
    }
  }
  const tokens = yield* prepareIntrinsic;
  expect(tokens).toHaveLength(3);
  const intrinsic = tokens.find(token => token.tableId === tableId);
  if (intrinsic === undefined) throw new Error("Missing Currency intrinsic definition");
  const nativeConstraints = yield* prepareRelationalUniqueDeclarations(persistence.drizzle, deploymentId, schemaVersionId, "medusa.currency");
  expect(nativeConstraints).toHaveLength(1);
  const unique = nativeConstraints[0];
  if (unique === undefined) throw new Error("Missing native Currency primary constraint");
  expect(unique).toMatchObject({ tableId, descriptor: "key/currency.primary" });
  expect(yield* Effect.result(prepareRelationalUniqueDeclarations(persistence.drizzle, deploymentId, schemaVersionId, "missing")))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "RelationalStorageDefinitionError", reason: "missingSource" } });
  expect(yield* Effect.result(prepareRelationalUniqueDeclarations(persistence.drizzle, deploymentId, schemaVersionId, "application")))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "RelationalStorageDefinitionError", reason: "unsupportedDefinition" } });
  // This test supplies the shared transaction owner with an ordinary Drizzle
  // starter. The helper owns cancellation drainage and preserves callback causes.
  const transact = <Value, Failure>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>) =>
    runEffectTransaction(callback => persistence.drizzle.transaction(callback), "Currency catalog test rollback", work,
      cause => new Error("Currency catalog transaction failed", { cause }));
  const rollback = new Error("intentional catalog corruption rollback");
  for (const change of [{ namespace: "app" as const }, { logicalName: "commerce.currency/impostor" }]) {
    const result = yield* Effect.result(transact(tx => Effect.gen(function* () {
      yield* runDrizzleStatementEffect(tx.update(fxControlTables).set(change).where(and(eq(fxControlTables.deploymentId, deploymentId), eq(fxControlTables.tableId, tableId))),
        cause => new Error("Could not arrange catalog corruption", { cause }));
      expect(yield* Effect.result(ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, intrinsic))).toMatchObject({
        _tag: "Failure", failure: { _tag: "AppCreationTimeIndexDefinitionParentError" },
      });
      expect(yield* Effect.result(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, unique))).toMatchObject({
        _tag: "Failure", failure: { _tag: "AppUniqueConstraintCatalogParentError", parent: "table" },
      });
      expect(yield* Effect.result(ensureRelationalOrderedDefinitions(tx, deploymentId, schemaVersionId, "medusa.currency")))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "RelationalStorageDefinitionError", reason: "tableBindingChanged" } });
      return yield* Effect.fail(rollback);
    })));
    expect(result).toMatchObject({ _tag: "Failure", failure: rollback });
  }
  const ensure = transact(tx => Effect.gen(function* () {
    const index = yield* ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, intrinsic);
    const constraint = yield* ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, unique);
    const ordered = yield* ensureRelationalOrderedDefinitions(tx, deploymentId, schemaVersionId, "medusa.currency");
    return { index, constraint, ordered };
  }));
  const results = yield* Effect.all([ensure, ensure], { concurrency: concurrent ? 2 : 1 });
  expect(results.map(result => result.index.definitionStatus).sort()).toEqual(["created", "existing"]);
  expect(results.map(result => result.constraint.definitionStatus).sort()).toEqual(["created", "existing"]);
  expect(results[0]?.constraint.definition.physicalSpec.orderedFields).toEqual(["code"]);
  expect(results[0]?.index.definition.access).toMatchObject({ kind: "by_creation_time", tableId });
  expect(results.flatMap(result => result.ordered.map(index => index.definitionStatus)).sort()).toEqual(["created", "created", "existing", "existing"]);
  expect(results[0]?.ordered.map(index => index.definition.physicalSpec.orderedFields[0])).toEqual([
    { kind: "documentPath", path: "code" }, { kind: "documentPath", path: "deleted_at" },
  ]);
  expect(results[0]?.ordered[1]?.definition.physicalSpec.predicate).toEqual({ kind: "fieldIsNull", field: "deleted_at" });
  const activeIndex = results[0]?.ordered[1]?.definition;
  if (activeIndex === undefined) throw new Error("Missing native Currency active-row index");
  const intrinsicDefinition = results[0]?.index.definition;
  if (intrinsicDefinition === undefined) throw new Error("Missing intrinsic definition");
  // Exercise the physical schema gate independently of the protocol decoder.
  // Each rejected update rolls its own transaction back; committed catalog
  // bytes and the valid native predicate remain unchanged.
  for (const [definition, predicate] of [
    [activeIndex, { kind: "fieldIsNull" }],
    [activeIndex, { kind: "fieldIsNull", field: "" }],
    [activeIndex, { kind: "fieldIsNull", field: "deleted_at", extra: true }],
    [activeIndex, null],
    [intrinsicDefinition, { kind: "fieldIsNull", field: "deleted_at" }],
  ] as const) {
    const rejected = yield* Effect.result(transact(tx => runDrizzleStatementEffect(tx.update(fxControlIndexDefinitions)
      .set({ physicalSpecJson: sql`${JSON.stringify({ ...definition.physicalSpec, predicate })}::jsonb` })
      .where(eq(fxControlIndexDefinitions.indexDefinitionId, definition.indexDefinitionId)),
    cause => new Error("Rejected malformed index spec", { cause }))));
    expect(rejected._tag).toBe("Failure");
    if (rejected._tag === "Failure") expect(findSqlState(rejected.failure)).toBe("23514");
  }
  expect(yield* Effect.result(loadPublishedPhysicalRequirementSnapshotV1(persistence.drizzle, { deploymentId, schemaVersionId })))
    .toMatchObject({ _tag: "Failure", failure: { reason: "publishedProjectionIncomplete" } });
  expect(yield* Effect.result(prepareAppUniqueConstraintSetClosureV1Effect(persistence.drizzle, { deploymentId, schemaVersionId })))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" } });
  expect(yield* runDrizzleStatementEffect(persistence.drizzle.select().from(fxControlSchemaVersionUniqueConstraintSets),
    cause => new Error("Read refused closure", { cause }))).toHaveLength(0);
  const whole = yield* transact(tx => ensureLogicalStorageDefinitions(tx, deploymentId, schemaVersionId));
  expect(whole.requirements.evidence.candidate.sources.map(source => source.key)).toEqual(["application", "payload", "medusa.currency", "payload.view.0"]);
  expect(whole.requirements.ordered.length).toBeGreaterThan(2);
  expect(whole.requirements.unique.length).toBeGreaterThan(1);
  for (const fault of ["extra", "renamed", "wrongSpec"] as const) {
    const rejected = yield* Effect.result(transact(tx => Effect.gen(function* () {
      if (fault === "renamed") {
        yield* runDrizzleStatementEffect(tx.update(fxControlUniqueConstraints).set({ descriptor: "key/impostor" }).where(and(
          eq(fxControlUniqueConstraints.deploymentId, deploymentId), eq(fxControlUniqueConstraints.tableId, tableId),
        )), cause => new Error("Arrange changed logical constraint identity", { cause }));
      } else {
        if (fault === "wrongSpec") {
          const currencyMember = whole.unique.find(member => member.identity.tableId === tableId);
          if (currencyMember === undefined) throw new Error("Missing Currency constraint binding");
          yield* runDrizzleStatementEffect(tx.delete(fxControlSchemaVersionUniqueConstraintBindings).where(and(
            eq(fxControlSchemaVersionUniqueConstraintBindings.deploymentId, deploymentId),
            eq(fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId, schemaVersionId),
            eq(fxControlSchemaVersionUniqueConstraintBindings.logicalUniqueConstraintId, currencyMember.identity.logicalUniqueConstraintId),
          )), cause => new Error("Arrange contradictory source binding", { cause }));
        }
        const prepared = yield* prepareAppUniqueConstraintDefinitionBindingV1Effect(tx, { deploymentId, schemaVersionId, tableId,
          descriptor: CatalogDefinitionNameSchema.make(fault === "extra" ? "key/extra" : "key/currency.primary"),
          physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
            orderedFields: [fault === "extra" ? "code" : "name"], sparse: false, localePolicy: { kind: "none" },
            keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }),
        });
        yield* ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared);
      }
      expect(yield* Effect.result(prepareAppUniqueConstraintSetClosureV1Effect(tx, { deploymentId, schemaVersionId })))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" } });
      return yield* Effect.fail(rollback);
    })));
    expect(rejected).toMatchObject({ _tag: "Failure", failure: rollback });
  }
  const close = transact(tx => Effect.gen(function* () {
    const prepared = yield* prepareAppUniqueConstraintSetClosureV1Effect(tx, { deploymentId, schemaVersionId });
    return yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared);
  }));
  yield* Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, bytes) =>
      new TextDecoder().decode(bytes).startsWith('{"bindings":') ? Promise.reject(nativeRejection) : digest(algorithm, bytes))),
    () => Effect.gen(function* () {
      expect(yield* Effect.result(close)).toMatchObject({ _tag: "Failure",
        failure: { _tag: "AppUniqueConstraintSetClosureResourceError", reason: "sourceUnavailable" } });
    }),
    spy => Effect.sync(() => spy.mockRestore()),
  );
  expect(yield* close).toMatchObject({ status: "closed", closure: { definitionCount: 2 } });
  expect(yield* close).toMatchObject({ status: "replayed", closure: { definitionCount: 2 } });
  return activeIndex;
});
