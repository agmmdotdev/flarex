import { Effect, Result } from "effect";
import { it, expect } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeScopeClockRecord } from "../../../src/scope/scopeClock";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { prepareLogicalWriteMechanics, combineLogicalWriteMechanics, makeLogicalDocumentWorkingSet } from "../../../src/storage/documents/logicalDocuments/workingSet";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";

it("keeps original prepared source groups separate after combining common-lineage catalogs, before SQL or FK claims", async () => {
  const failure = (reason: string) => new Error(reason);
  const origin = { kind: "synthetic", sourceId: "neutral-related-source-groups" };
  const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, capabilities: [],
    tables: ["first", "second"].map(tableId => ({ tableId, origin, columns: [{ columnId: "id", type: "text", nullable: false,
      default: { kind: "none" }, origin }], keys: [{ keyId: tableId + ".primary", kind: "primary", columns: ["id"], origin }],
      indexes: [], constraints: [], relationships: [] })) }));
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const groups = [];
    for (const [index, table] of schema.tables.entries()) groups.push(yield* prepareLogicalWriteMechanics({
      tables: [{ tableId: decodeCatalogTableId(index + 1), logicalName: table.identity.tableId, relational: table }],
      relationalCapabilities: [], indexes: [], unique: [],
    }, failure));
    const combined = yield* combineLogicalWriteMechanics(groups, failure);
    const clock = decodeScopeClockRecord({ scopeId: "scope_73100000-0000-4000-8000-000000000001", epoch: "epoch_related-groups",
      storageGeneration: "flarexdb_v1", storageGenerationFence: 1n, lastCommitSeq: 0n, lastMetadataSequence: 0n,
      oldestAvailableCommitSeq: 0n, updatedAt: new Date("2026-10-29T00:00:00Z") });
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 8, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "related-source-groups", "write"), owner => owner.close);
    if (combined.relationalCapabilities === undefined) throw failure("Missing original relational capability profile");
    let storageReads = 0;
    const working = yield* makeLogicalDocumentWorkingSet({ scopeId: clock.scopeId, clock, lifetime,
      tables: combined.tables, writeMechanics: combined, relationalCapabilities: combined.relationalCapabilities,
      searchDefinitions: combined.searchDefinitions,
      readTransaction: () => { storageReads++; return Effect.die("Cross-source query must refuse before any storage callback"); },
      requireAdmission: Effect.void, validateDocument: () => Effect.void, error: failure, uniqueConflict: () => failure("uniqueConflict"),
      limits: { identities: 8, pageRows: 8, documentBytes: 8192 },
    }, AppCreationTimeV1Schema.make(1), combined.unique, combined.indexes);
    const id = yield* lifetime.begin(lifetime.context);
    const store = yield* working.relationalTable(lifetime.context, id, "first");
    if (store.related === undefined) throw failure("Missing prepared related capability");
    // Claiming a local FK cannot turn a different issued source group into a
    // related table, even when schema owner and lineage are exactly identical.
    expect(yield* store.related(lifetime.context, { childTable: "second", foreignKey: "claimed", predicate: { kind: "and", children: [] } })
      .pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(storageReads).toBe(0);
  })));
});
