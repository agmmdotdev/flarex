import { fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../src/schema";
import { fxSystemCommitRelationalChanges } from "../src/commitPublication/relationalFactsSchema";
import { fxSystemFrameworkInitializations } from "../src/frameworkSchema/installation/initializationSchema";
import type { CommerceHostTestFixture } from "./commerceHostFixture";
import type { CommerceProfileState } from "../src/commerceTransaction/profile";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { createRetainedCommitHistoryCompactionPort, compactRetainedCommitHistoryPageEffect } from "../src/retainedCommitHistoryCompaction";
import { createLocatedRetainedHistoryFloorTargetInternal, type LocatedRetainedHistoryFloorTarget } from "../src/retainedHistoryFloorObservation";
import type { ExactTrustedScopeAuthorityResolutionPorts } from "../src/scopeAuthorityResolution";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from "../src/transactionSessionActivation";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { runEffect } from "./effectTestRuntime";

/** Physical-layout inspector for cross-framework assertions. Dynamic identifiers
 * come only from the captured fixture layout; ordinary metadata uses typed tables. */
export async function commerceInventory(fixture: CommerceHostTestFixture) {
  const db = fixture.persistence.drizzle;
  const layout = fixture.descriptor.layout.frame;
  const table = layout.tables[0];
  if (table === undefined) throw new Error("Missing admitted fixture table");
  const tables = await commercePhysicalRows(fixture.persistence, layout);
  const rows = tables[table.identity.tableId];
  if (rows === undefined) throw new Error("Missing fixture inventory");
  return { rows, tables, commits: await db.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
    facts: await db.select().from(fxSystemCommitRelationalChanges).orderBy(fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal),
    outcomes: await db.select().from(fxSystemIdempotency), wakes: await db.select().from(fxSystemCommitWakes), clocks: await db.select().from(fxSystemScopeClocks),
    initialization: await db.select().from(fxSystemFrameworkInitializations) };
}

/** Inspect the actual admitted physical tables without creating a second layout reader. */
export async function commercePhysicalRows(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  layout: CommerceProfileState["layout"]["frame"],
) {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const tables: Record<string, readonly Record<string, unknown>[]> = {};
  for (const physical of layout.tables) {
    const fields = physical.columns.map(field => `${quote(field.name)} as ${quote(field.identity.columnId)}`).join(", ");
    const key = (physical.keys.find(key => key.kind === "primary") ?? physical.keys.find(key => key.kind === "unique"))?.columns;
    if (key === undefined || key.length === 0) throw new Error("Missing declared key");
    tables[physical.identity.tableId] = (await persistence.query(`select ${fields} from ${quote(layout.targetNamespace.schemaName)}.${quote(physical.name)} order by ${key.map(quote).join(", ")}`)).rows;
  }
  return tables;
}

/** Exercise the existing retention owner with the newest fixture commit kept. */
export async function compactCommerceHistory(fixture: CommerceHostTestFixture) {
  const before = await commerceInventory(fixture);
  await compactRetainedCommitHistory(fixture.hostInput, fixture.persistence, before);
  return commerceInventory(fixture);
}

/** Drive the shared commit-history owner for physical or logical test hosts. */
export async function compactRetainedCommitHistory(
  owner: Readonly<{ authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedRetainedHistoryFloorTarget>; deploymentId: string; scopeId: ScopeId }>,
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  before: Pick<Awaited<ReturnType<typeof commerceInventory>>, "commits" | "clocks">,
) {
  const last = before.commits.at(-1);
  const clock = before.clocks[0];
  if (last === undefined || clock?.scopeUuid === undefined || clock.scopeUuid === null) throw new Error("Missing retained history");
  const db = persistence.drizzle;
  await db.update(fxSystemScopeClocks).set({ oldestAvailableCommitSeq: last.commitSeq }).where(eq(fxSystemScopeClocks.scopeUuid, clock.scopeUuid));
  const port = createRetainedCommitHistoryCompactionPort({ authority: { ...owner.authority, scopeClockTargets: {
    resolve: async locator => createLocatedRetainedHistoryFloorTargetInternal(db, locator, createDefaultLocatedReadCommittedTransactionRunnerV1(db)),
  } } });
  const exhausted = await runEffect(Effect.gen(function* () {
    for (let page = 0; page < before.commits.length; page++) {
      const result = yield* compactRetainedCommitHistoryPageEffect(port, { deploymentId: owner.deploymentId, scopeId: owner.scopeId });
      if (result.disposition === "exhausted") return true;
    }
    return false;
  }));
  if (!exhausted) throw new Error("Retained commit history did not exhaust within the fixture's commit count");
}

/** Arrange the documented expired-result state independently of feed retention. */
export async function expireCommerceResult(fixture: Pick<CommerceHostTestFixture, "persistence">, requestKey: string) {
  const db = fixture.persistence.drizzle;
  const outcome = (await db.select().from(fxSystemIdempotency)).find(row => row.requestKey === requestKey);
  if (outcome === undefined) throw new Error("Missing retained request outcome");
  await db.update(fxSystemIdempotency).set({ resultState: "expired", resultValueCodecVersion: null,
    resultSemanticBytes: null, resultBytes: null, resultSha256: null,
    resultExpiredAt: sql`greatest(${fxSystemIdempotency.createdAt}, clock_timestamp())`,
  }).where(and(eq(fxSystemIdempotency.scopeUuid, outcome.scopeUuid), eq(fxSystemIdempotency.requestKey, outcome.requestKey)));
}
