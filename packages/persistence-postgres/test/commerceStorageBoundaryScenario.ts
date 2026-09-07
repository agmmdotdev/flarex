import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { commerceInventory } from "./commerceInventory";
import type { CommerceHostTestFixture } from "./commerceHostFixture";

/** Deliberate out-of-band corruption; the service must refuse before hydrating
 * an oversized stored payload. The helper only uses admitted logical columns. */
export async function commerceStorageBoundaryScenario(fixture: CommerceHostTestFixture,
  selected: { column: string; keyColumn: string; key: string }, read: () => Promise<unknown>) {
  const before = await commerceInventory(fixture);
  const table = fixture.descriptor.layout.frame.tables[0];
  const column = table?.columns.find(field => field.identity.columnId === selected.column);
  const key = table?.columns.find(field => field.identity.columnId === selected.keyColumn);
  const scope = before.clocks[0]?.scopeUuid;
  const original = before.rows.find(row => row[selected.keyColumn] === selected.key)?.[selected.column];
  if (table === undefined || column === undefined || key === undefined || scope == null || typeof original !== "string") throw new Error("Invalid boundary fixture");
  const target = sql`${sql.identifier(fixture.descriptor.layout.frame.targetNamespace.schemaName)}.${sql.identifier(table.name)}`;
  const filter = sql`scope_uuid = ${scope}::uuid and ${sql.identifier(key.name)} = ${selected.key}`;
  try {
    await fixture.persistence.drizzle.execute(sql`update ${target} set ${sql.identifier(column.name)} = repeat('x', 1000000) where ${filter}`);
    await expect(read()).rejects.toMatchObject({ reason: "limitExceeded" });
  } finally {
    await fixture.persistence.drizzle.execute(sql`update ${target} set ${sql.identifier(column.name)} = ${original} where ${filter}`);
  }
  // Managed timestamp triggers legitimately observe these fixture writes.
  expect((await commerceInventory(fixture)).commits).toEqual(before.commits);
}
