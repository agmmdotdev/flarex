import { fxSystemCommits, fxSystemIdempotency, fxSystemOutbox, fxSystemScopeClocks } from "../src/schema";
import { fxSystemCommitRelationalChanges } from "../src/commitPublication/relationalFactsSchema";
import { fxSystemFrameworkInitializations } from "../src/frameworkSchema/installation/initializationSchema";
import type { CommerceHostTestFixture } from "./commerceHostFixture";

/** Physical-layout inspector for cross-framework assertions. Dynamic identifiers
 * come only from the captured fixture layout; ordinary metadata uses typed tables. */
export async function commerceInventory(fixture: CommerceHostTestFixture) {
  const db = fixture.persistence.drizzle;
  const layout = fixture.descriptor.layout.frame;
  const table = layout.tables[0];
  if (table === undefined) throw new Error("Missing admitted fixture table");
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const fields = table.columns.map(field => `${quote(field.name)} as ${quote(field.identity.columnId)}`).join(", ");
  const key = table.keys.find(key => key.kind === "primary")?.columns.filter(name => name !== "scope_uuid");
  if (key === undefined || key.length === 0) throw new Error("Missing admitted key");
  const rows = (await fixture.persistence.query(`select ${fields} from ${quote(layout.targetNamespace.schemaName)}.${quote(table.name)} order by ${key.map(quote).join(", ")}`)).rows;
  return { rows, commits: await db.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
    facts: await db.select().from(fxSystemCommitRelationalChanges).orderBy(fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal),
    outcomes: await db.select().from(fxSystemIdempotency), wakes: await db.select().from(fxSystemOutbox), clocks: await db.select().from(fxSystemScopeClocks),
    initialization: await db.select().from(fxSystemFrameworkInitializations) };
}
