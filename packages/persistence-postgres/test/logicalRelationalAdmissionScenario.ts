import { Effect, Result } from "effect";
import { expect, vi } from "vitest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { JsonObject } from "flarex-protocol/json";
import { prepareLogicalRelationalAdmission, requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../src/logicalDocuments/relationalAdmission";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import type { LogicalDocumentWrite } from "../src/logicalDocuments/model";
import { compileLogicalRelationalRead } from "../src/logicalDocuments/relationalQuery";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../src/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../src/appIndexDefinitions";
import { locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../src/appUniqueConstraintDefinitions";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { fxAppRowCurrent } from "../src/schema";
import { makeCommerceCommandContext } from "../src/commerceTransaction/context";
import { commerceError, logicalCommerceError, type CommerceTransactionError } from "../src/commerceTransaction/model";
import type { CommerceCommandContext } from "../src/commerceTransaction/commands";
import { defaultCommerceResources } from "../src/commerceTransaction/resources";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "./fixtures/applicationNativeMutationTestFixture";

/** Native-source admission and scalar lifecycle in the real pending working set.
 * Publication and initialization are intentionally not claimed. */
export const logicalRelationalAdmissionScenario = Effect.fn("LogicalRelationalAdmission.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, schemaVersionId: CatalogSchemaVersionId,
  source: Readonly<{ sourceKey: string; writeProfile: string; schema: unknown; evidence: unknown }>, rows: readonly JsonObject[],
  nativeReads: readonly Readonly<{ query: unknown; expected: unknown }>[],
  executeNative: (context: CommerceCommandContext, scenario: "success" | "invalid" | "missingUpdate" | "unknownUpdate") => Effect.Effect<unknown, CommerceTransactionError>,
) {
  const { control, target, deploymentId, authority, authorityPorts } = fixture;
  const input = { deploymentId, scopeId: authority.scopeId, schemaVersionId };
  const ports = { controlDb: control.drizzle, authority: authorityPorts };
  const mutablePorts = { ...ports };
  const originalSelect = control.drizzle.select.bind(control.drizzle);
  const prepared = yield* Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(control.drizzle, "select").mockImplementationOnce(fields => {
      // Change the caller's catalog after composition authentication but before
      // the first catalog read completes. Later preparation must retain its owner.
      mutablePorts.controlDb = target.drizzle;
      return originalSelect(fields);
    })),
    () => prepareLogicalRelationalAdmission(mutablePorts, fixture.uniqueConstraintEligibility, input, source),
    firstRead => Effect.sync(() => firstRead.mockRestore()),
  );
  expect(mutablePorts.controlDb).toBe(target.drizzle);
  for (const wrong of [{ ...source, evidence: {} }, { ...source, writeProfile: "other.profile" }, { ...source, sourceKey: "application" }]) {
    expect(yield* Effect.result(prepareLogicalRelationalAdmission(ports, fixture.uniqueConstraintEligibility, input, wrong)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "sourceMismatch" } });
  }
  const resolved = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authorityPorts);
  const active = yield* fixture.activation.readActive();
  const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(control.drizzle, { deploymentId, schemaVersionId });
  if (snapshot === null) throw new Error("Missing logical definitions");
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement, cause => new Error("Admission fixture statement", { cause }));
  const before = yield* query(target.drizzle.select().from(fxAppRowCurrent));
  yield* runEffectTransaction(work => target.drizzle.transaction(work), "Logical source admission fixture",
    (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, authority.scopeId);
      let entered = false;
      expect(yield* Effect.result(prepared.withAdmission(active.selection, tx, { ...resolved.authority, deploymentId: "foreign" }, clock,
        () => Effect.sync(() => { entered = true; })))).toMatchObject({ _tag: "Failure", failure: { reason: "scopeMismatch" } });
      expect(entered).toBe(false);
      let failedToken: LogicalRelationalAdmission | undefined;
      const rejected = new Error("Native participant rejected");
      expect(yield* Effect.result(prepared.withAdmission(active.selection, tx, resolved.authority, clock,
        admission => Effect.sync(() => { failedToken = admission; }).pipe(Effect.andThen(Effect.fail(rejected))))))
        .toMatchObject({ _tag: "Failure", failure: rejected });
      if (failedToken === undefined) throw new Error("Missing failed callback token");
      expect(yield* Effect.result(requireLogicalRelationalAdmission(failedToken, tx)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
        { calls: 32, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "native-source", "write"), lifetime => lifetime.close);
      const leaked = yield* prepared.withAdmission(active.selection, tx, resolved.authority, clock, admission => Effect.gen(function* () {
        const selected = yield* requireLogicalRelationalAdmission(admission, tx);
        expect(selected.sourceKey).toBe(source.sourceKey);
        expect(selected.tables).toHaveLength(1);
        // SAFETY: intentionally copy an inert token to test nominal admission.
        expect(yield* Effect.result(requireLogicalRelationalAdmission({ ...admission } as LogicalRelationalAdmission, tx)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
        yield* runEffectTransaction(work => control.drizzle.transaction(work), "Foreign admission transaction",
          (other: FlarexMetadataTransaction) => requireLogicalRelationalAdmission(admission, other).pipe(Effect.result,
            Effect.tap(result => Effect.sync(() => expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } })))), cause => failure("Foreign transaction", cause));
        const table = selected.tables[0];
        if (table === undefined) throw new Error("Missing native table");
        const unique = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(control.drizzle, deploymentId, authority.scopeId,
          schemaVersionId, [table.tableId], 1);
        if (unique === null) throw new Error("Missing native unique definition");
        const indexes = yield* Effect.forEach(snapshot.definitions.filter(definition => definition.access.tableId === table.tableId),
          definition => locateAppIndexDefinitionByIdEffect(control.drizzle, authority.scopeId, definition.indexDefinitionId)
            .pipe(Effect.flatMap(located => located === null ? Effect.die("Missing native index definition") : Effect.succeed(located))));
        const reads: string[] = [];
        const guard = requireLogicalRelationalAdmission(admission, tx).pipe(Effect.asVoid);
        const workingConfiguration = { tx, scopeId: authority.scopeId, clock, lifetime,
          tables: selected.tables.map(table => ({ tableId: table.tableId, logicalName: table.localName, relational: table.definition })),
          relationalCapabilities: selected.schema.capabilities,
          requireAdmission: guard, validateDocument: (write: LogicalDocumentWrite) => Effect.fromResult(selected.values.validate(write.tableId, write.document)),
          error: failure, uniqueConflict: () => failure("uniqueConflict"), limits: { pageRows: 10, identities: 10, documentBytes: 65_536 },
        };
        const working = yield* makeLogicalDocumentWorkingSet(workingConfiguration, AppCreationTimeV1Schema.make(1), unique, indexes,
        { beforeRead: kind => Effect.sync(() => { reads.push(kind); }) });
        const id = yield* lifetime.begin(lifetime.context);
        const native = rows[0];
        if (native === undefined || typeof native.code !== "string" || typeof native.name !== "string")
          throw new Error("Missing native seed row");
        const inserted = yield* working.documents.insert(lifetime.context, id, table.localName,
          { ...native, created_at: "2026-09-21T00:00:00.000Z", updated_at: "2026-09-21T00:00:00.000Z", deleted_at: null });
        expect(inserted._id).not.toBe(native.code);
        expect((yield* working.documents.find(lifetime.context, id, table.localName, { where: { code: native.code }, offset: 0, limit: 1 })).docs)
          .toEqual([inserted]);
        expect(reads).not.toContain("scan");
        for (const [position, row] of rows.slice(1, 3).entries()) yield* working.documents.insert(lifetime.context, id, table.localName,
          { ...row, created_at: "2026-09-21T00:00:00.000Z", updated_at: "2026-09-21T00:00:00.000Z",
            deleted_at: position === 0 ? "2026-09-21T00:00:00.000Z" : null });
        for (const read of nativeReads) expect(yield* working.relationalFind(lifetime.context, id, table.localName, read.query)).toEqual(read.expected);
        const anchored = { order: { column: "code", direction: "asc" }, predicate: { kind: "and", children: [
          { kind: "in", column: "code", values: [native.code] }, { kind: "in", column: "name", values: [native.name] },
        ] } };
        expect(Result.getOrThrow(compileLogicalRelationalRead(table.definition, selected.schema.capabilities,
          anchored, 10, failure)).selections).toMatchObject([{ column: "code", value: native.code }]);
        expect((yield* working.relationalFind(lifetime.context, id, table.localName, anchored)).docs)
          .toMatchObject([{ code: native.code, name: native.name }]);
        expect((yield* working.relationalFind(lifetime.context, id, table.localName, { ...anchored,
          predicate: { kind: "and", children: [
            { kind: "in", column: "code", values: [native.code] }, { kind: "in", column: "name", values: ["no-match"] },
          ] },
        })).docs).toEqual([]);
        const nullAnchored = { order: { column: "code", direction: "asc" }, predicate: { kind: "and", children: [
          { kind: "isNull", column: "deleted_at" }, { kind: "in", column: "name", values: [native.name] },
        ] } };
        expect(Result.getOrThrow(compileLogicalRelationalRead(table.definition, selected.schema.capabilities,
          nullAnchored, 10, failure)).requiresIndexedNullAnchor).toBe(true);
        expect((yield* working.relationalFind(lifetime.context, id, table.localName, nullAnchored)).docs)
          .toMatchObject([{ code: native.code, name: native.name }]);
        expect((yield* working.relationalFind(lifetime.context, id, table.localName, { ...nullAnchored,
          predicate: { kind: "and", children: [
            { kind: "isNull", column: "deleted_at" }, { kind: "in", column: "name", values: ["no-match"] },
          ] },
        })).docs).toEqual([]);
        expect(reads).toContain("index");
        expect(reads).not.toContain("scan");
        const order = { column: "code", direction: "asc" };
        const projection = yield* Effect.fromResult(compileLogicalRelationalRead(table.definition, selected.schema.capabilities, { fields: ["code"], order }, 10, failure));
        for (const invalid of [{ ...inserted, undeclared: "hidden" }, { ...inserted, decimal_digits: "invalid hidden value" }])
          expect(projection.inspect(invalid)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
        for (const predicate of [
          { kind: "in", column: "name", values: ["foreign"] }, { kind: "isNull", column: "foreign" },
          { kind: "or", children: [{ kind: "in", column: "code", values: [native.code] },
            { kind: "in", column: "name", values: [native.name] }] },
          { kind: "in", column: "code", values: [null] },
          { kind: "and", children: Array.from({ length: 65 }, () => ({ kind: "and", children: [] })) },
        ]) expect(Result.isFailure(compileLogicalRelationalRead(table.definition, selected.schema.capabilities, { order, predicate }, 10, failure))).toBe(true);
        yield* lifetime.seal;
        const closed = yield* working.close();
        yield* Effect.scoped(Effect.gen(function* () {
          const refusalLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
            { calls: 32, commandBytes: 65_536, commandMs: 60_000 }, {}, {}, "native-null-refusal", "read"), resource => resource.close);
          const withoutNullIndex = yield* makeLogicalDocumentWorkingSet({ ...workingConfiguration, lifetime: refusalLifetime },
            AppCreationTimeV1Schema.make(1), unique,
            indexes.filter(index => index.physicalSpec.predicate?.kind !== "fieldIsNull"));
          const refusalId = yield* refusalLifetime.begin(refusalLifetime.context);
          expect(yield* Effect.result(withoutNullIndex.relationalFind(refusalLifetime.context, refusalId,
            table.localName, nullAnchored))).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
        }));
        expect(closed.changes).toHaveLength(3);
        expect(closed.indexReads.some(read => read.definition.physicalSpec.predicate?.kind === "fieldIsNull" &&
          read.definition.physicalSpec.predicate.field === "deleted_at"))
          .toBe(true);
        expect(closed.indexReads.some(read => read.definition.physicalSpec.predicate === undefined &&
          read.definition.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
          read.definition.physicalSpec.orderedFields[0]?.path === "code")).toBe(true);
        const live = closed.changes[0];
        if (live?.kind !== "live") throw new Error("Missing pending native row");
        const alien = snapshot.definitions.find(definition => definition.access.tableId !== table.tableId);
        if (alien === undefined) throw new Error("Missing independent table");
        expect(selected.values.validate(alien.access.tableId, live.document))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTable" } });
        expect(Result.isSuccess(selected.values.validate(table.tableId, live.document))).toBe(true);
        return admission;
      }));
      expect(yield* Effect.result(requireLogicalRelationalAdmission(leaked, tx)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      for (const scenario of ["success", "invalid", "missingUpdate", "unknownUpdate"] as const) yield* prepared.withAdmission(active.selection, tx, resolved.authority, clock, admission => Effect.scoped(Effect.gen(function* () {
        const selected = yield* requireLogicalRelationalAdmission(admission, tx);
        const nativeTable = selected.tables[0];
        if (nativeTable === undefined) throw new Error("Missing native table");
        const unique = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(control.drizzle, deploymentId, authority.scopeId,
          schemaVersionId, [nativeTable.tableId], 1);
        if (unique === null) throw new Error("Missing native unique definition");
        const indexes = yield* Effect.forEach(snapshot.definitions.filter(definition => definition.access.tableId === nativeTable.tableId),
          definition => locateAppIndexDefinitionByIdEffect(control.drizzle, authority.scopeId, definition.indexDefinitionId)
            .pipe(Effect.flatMap(located => located === null ? Effect.die("Missing native index definition") : Effect.succeed(located))));
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
          { calls: 128, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "native-currency-service", "write"), lifetime => lifetime.close);
        const capabilities = selected.schema.capabilities.map(capability => structuredClone(capability));
        const nativeTables = selected.tables.map(table => ({ tableId: table.tableId, logicalName: table.localName,
          relational: { ...table.definition, columns: table.definition.columns.map(column => structuredClone(column)) } }));
        const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId: authority.scopeId, clock, lifetime,
          tables: nativeTables, relationalCapabilities: capabilities,
          requireAdmission: Effect.sync(() => {
            // Mutate the caller's backing metadata at the first constructor yield.
            // All later native reads/defaults/lifecycle must retain the selection.
            capabilities.splice(0);
            for (const table of nativeTables) table.relational.columns.splice(0);
          }).pipe(Effect.andThen(requireLogicalRelationalAdmission(admission, tx)), Effect.asVoid,
            Effect.mapError(cause => commerceError("invalidAuthority", cause))),
          validateDocument: write => Effect.fromResult(selected.values.validate(write.tableId, write.document))
            .pipe(Effect.mapError(cause => commerceError("invalidInput", cause))), error: logicalCommerceError,
          uniqueConflict: () => commerceError("invalidInput"), limits: { pageRows: 256, identities: 128, documentBytes: 65_536 },
        }, AppCreationTimeV1Schema.make(1), unique, indexes);
        expect(capabilities).toHaveLength(0);
        expect(nativeTables[0]?.relational.columns).toHaveLength(0);
        const id = yield* lifetime.begin(lifetime.context);
        const store = yield* working.relationalTable(lifetime.context, id, nativeTable.localName);
        const context = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources,
          table: (manager, table) => working.relationalTable(manager, id, table) }, id, lifetime.context,
          () => Effect.fail(commerceError("unsupportedProfile")), () => Effect.fail(commerceError("unadmittedEvent")));
        yield* executeNative(context, scenario);
        if (scenario !== "success") {
          expect(yield* Effect.result(lifetime.seal)).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
          expect(yield* Effect.result(working.close())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
          return;
        }
        yield* store.lifecycle(lifetime.context, "restore", ["zzz"]);
        const deleted = yield* store.lifecycle(lifetime.context, "softDelete", ["zzz"]);
        expect(deleted[0]?.deleted_at).toBe(deleted[0]?.updated_at);
        const restored = yield* store.lifecycle(lifetime.context, "restore", ["zzz"]);
        expect(restored[0]?.deleted_at).toBe(null);
        expect(restored[0]?.created_at).toBe(restored[0]?.updated_at);
        yield* lifetime.seal;
        const changes = yield* working.close();
        expect(changes.changes).toHaveLength(1);
        expect(changes.noFinalRows).toHaveLength(2);
        expect(changes.attempts).toHaveLength(10);
        expect(changes.scans).toHaveLength(0);
      })));
    })), cause => new Error("Admission fixture transaction", { cause }));
  expect(yield* query(target.drizzle.select().from(fxAppRowCurrent))).toEqual(before);
});
