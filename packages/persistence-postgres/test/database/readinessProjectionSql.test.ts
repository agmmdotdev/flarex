import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { expect, it, vi } from "vitest";
import { CatalogIndexDefinitionIdSchema } from "flarex-protocol/catalog";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { makePhysicalSessionAccess } from "../../src/database/physicalSession/drizzle";
import { flarexSchema, fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations,
  fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../../src/database/schema";
import { scopeClockSelection, selectScopeClockRows } from "../../src/scope/scopeClock";
import { indexBuildStateSelection, indexMaintenanceBindingPredicate } from "../../src/storage/indexes/indexBuildStates";

const access = makePhysicalSessionAccess(flarexSchema);
const firstScope = ScopeIdSchema.make("projection-first");
const secondScope = ScopeIdSchema.make("projection-second");

// The reference constructs the pre-retention selection through native Drizzle.
function nativeClockSelection() {
  return { ...getTableColumns(fxSystemScopeClocks),
    updatedAt: sql`greatest(${fxSystemScopeClocks.updatedAt}, ${fxSystemScopeExecutionAuthorities.updatedAt})`.mapWith(fxSystemScopeClocks.updatedAt),
    storageGeneration: fxSystemScopeExecutionAuthorities.storageGeneration,
    storageGenerationFence: fxSystemScopeExecutionAuthorities.storageGenerationFence,
    oldestAvailableCommitSeq: fxSystemScopeExecutionAuthorities.oldestAvailableCommitSeq,
    epoch: fxSystemScopeExecutionAuthorities.epoch,
    epochUuid: fxSystemScopeExecutionAuthorities.epochUuid,
    authorizationRevocationEpoch: fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch,
  };
}

it("preserves the native clock projection while binding fresh parameters and lock modes", () => {
  const first = access(new Client()).database;
  const second = access(new Client()).database;
  const firstQuery = selectScopeClockRows(first).where(eq(fxSystemScopeClocks.scopeId, firstScope))
    .limit(1).for("key share", { of: fxSystemScopeClocks });
  const secondQuery = selectScopeClockRows(second).where(eq(fxSystemScopeClocks.scopeId, secondScope))
    .limit(2).for("share", { of: fxSystemScopeExecutionAuthorities });
  const expectedFirst = first.select(nativeClockSelection()).from(fxSystemScopeClocks)
    .innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .where(eq(fxSystemScopeClocks.scopeId, firstScope)).limit(1).for("key share", { of: fxSystemScopeClocks }).toSQL();
  const expectedSecond = second.select(nativeClockSelection()).from(fxSystemScopeClocks)
    .innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .where(eq(fxSystemScopeClocks.scopeId, secondScope)).limit(2).for("share", { of: fxSystemScopeExecutionAuthorities }).toSQL();
  expect(first._.session).not.toBe(second._.session);
  expect(firstQuery).not.toBe(secondQuery);
  expect(firstQuery.toSQL()).toEqual(expectedFirst);
  expect(secondQuery.toSQL()).toEqual(expectedSecond);
  expect(firstQuery.toSQL().params).toEqual([firstScope, 1]);
  expect(secondQuery.toSQL().params).toEqual([secondScope, 2]);
  expect(scopeClockSelection()).toBe(scopeClockSelection());
  expect(Object.isFrozen(scopeClockSelection())).toBe(true);
});

it("keeps native timestamp and bigint row codecs on fresh client-bound executions", async () => {
  const firstClient = new Client();
  const secondClient = new Client();
  // No connection is opened: the native prepared-query and row mapper receive
  // ordinary pg array rows from a bounded transport double.
  const firstTransport = vi.fn(async () => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [],
    rows: [["2026-10-10 10:11:12+00", "9007199254740993"]] }));
  const secondTransport = vi.fn(async () => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [],
    rows: [["2026-10-10 12:13:14+00", "9007199254740995"]] }));
  Object.assign(firstClient, { query: firstTransport });
  Object.assign(secondClient, { query: secondTransport });
  const first = access(firstClient).database;
  const second = access(secondClient).database;
  const firstRows = await first.select({ updatedAt: scopeClockSelection().updatedAt,
    lastCommitSeq: scopeClockSelection().lastCommitSeq }).from(fxSystemScopeClocks)
    .innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .where(eq(fxSystemScopeClocks.scopeId, firstScope));
  const secondRows = await second.select({ updatedAt: scopeClockSelection().updatedAt,
    lastCommitSeq: scopeClockSelection().lastCommitSeq }).from(fxSystemScopeClocks)
    .innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .where(eq(fxSystemScopeClocks.scopeId, secondScope));
  expect(firstRows).toEqual([{ updatedAt: new Date("2026-10-10T10:11:12Z"), lastCommitSeq: 9007199254740993n }]);
  expect(secondRows).toEqual([{ updatedAt: new Date("2026-10-10T12:13:14Z"), lastCommitSeq: 9007199254740995n }]);
  expect(firstTransport).toHaveBeenCalledTimes(1);
  expect(secondTransport).toHaveBeenCalledTimes(1);
  expect(firstTransport).toHaveBeenCalledWith(expect.objectContaining({ rowMode: "array" }), [firstScope]);
  expect(secondTransport).toHaveBeenCalledWith(expect.objectContaining({ rowMode: "array" }), [secondScope]);
});

it("preserves nested maintenance projection and ordered native index readiness SQL", () => {
  const db = access(new Client()).transaction;
  const definitionIds = [CatalogIndexDefinitionIdSchema.make(7), CatalogIndexDefinitionIdSchema.make(11)];
  const predicate = and(eq(fxSystemIndexBuildStates.scopeId, firstScope), inArray(fxSystemIndexBuildStates.indexDefinitionId, definitionIds));
  const retained = db.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
    .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(predicate)
    .orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for("key share", { of: fxSystemIndexBuildStates });
  const native = db.select({ ...getTableColumns(fxSystemIndexBuildStates),
    maintenanceObligation: getTableColumns(fxSystemIndexMaintenanceObligations) }).from(fxSystemIndexBuildStates)
    .leftJoin(fxSystemIndexMaintenanceObligations, and(
      eq(fxSystemIndexMaintenanceObligations.scopeId, fxSystemIndexBuildStates.scopeId),
      eq(fxSystemIndexMaintenanceObligations.indexDefinitionId, fxSystemIndexBuildStates.indexDefinitionId),
      eq(fxSystemIndexMaintenanceObligations.activationSequence, fxSystemIndexBuildStates.maintenanceActivationSequence)))
    .where(predicate).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for("key share", { of: fxSystemIndexBuildStates });
  expect(retained.toSQL()).toEqual(native.toSQL());
  expect(retained.toSQL().params).toEqual([firstScope, ...definitionIds]);
  expect(indexBuildStateSelection()).toBe(indexBuildStateSelection());
  expect(Object.isFrozen(indexBuildStateSelection())).toBe(true);
  expect(Object.isFrozen(indexBuildStateSelection().maintenanceObligation)).toBe(true);
});

it("binds custom observed maintenance projections freshly without changing the fixed binding", () => {
  const dialect = new PgDialect();
  const fixed = indexMaintenanceBindingPredicate();
  const first = indexMaintenanceBindingPredicate(sql`${firstScope}`, sql`${7}`, sql`${13n}`);
  const second = indexMaintenanceBindingPredicate(sql`${secondScope}`, sql`${11}`, sql`${19n}`);
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  if (first === undefined || second === undefined || fixed === undefined) throw new Error("Expected native binding SQL");
  expect(dialect.sqlToQuery(first).params).toEqual([firstScope, 7, 13n]);
  expect(dialect.sqlToQuery(second).params).toEqual([secondScope, 11, 19n]);
  expect(dialect.sqlToQuery(fixed).params).toEqual([]);
  expect(indexMaintenanceBindingPredicate()).toBe(fixed);
  expect(first).not.toBe(second);
});
