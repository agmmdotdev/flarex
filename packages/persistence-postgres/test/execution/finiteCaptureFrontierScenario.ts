import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { FlarexSqlClient } from "../../src";

/** Fault the actual installed contracts and require the maintenance owner to
 * refuse reopening. This never substitutes a test-owned integrity verifier. */
export async function finiteCaptureFrontierScenario(
  persistence: Pick<FlarexSqlClient, "query" | "execute">,
  schemaName: string,
  migrate: () => Promise<void>,
): Promise<void> {
  await migrate();
  const functions = (await persistence.execute<{
    name: string; signature: string; definition: string; scalar: boolean;
  }>(sql`select p.proname as name,p.oid::pg_catalog.regprocedure::text as signature,
    pg_catalog.pg_get_functiondef(p.oid) as definition,not p.proretset as scalar
    from pg_catalog.pg_proc p where p.pronamespace=${schemaName}::pg_catalog.regnamespace
      and p.proname in ('fx_lock_installation_frontier','fx_accept_finite_placement_frontier','fx_accept_finite_storage_capture')`)).rows;
  expect(functions).toHaveLength(3);
  expect(functions.every(fn => fn.scalar)).toBe(true);
  expect((await persistence.execute(sql`select count(*)::int as count from pg_catalog.pg_proc p
    where p.pronamespace=${schemaName}::pg_catalog.regnamespace
      and p.proname in ('fx_lock_finite_scope_observation','fx_lock_read_scope_placement')`)).rows)
    .toEqual([{ count: 0 }]);
  const placement = functions.find(fn => fn.name === "fx_accept_finite_placement_frontier");
  const installation = functions.find(fn => fn.name === "fx_lock_installation_frontier");
  const capture = functions.find(fn => fn.name === "fx_accept_finite_storage_capture");
  if (placement === undefined || installation === undefined || capture === undefined)
    throw new Error("Missing installed scalar frontier owner");
  const changedPlacement = placement.definition.replace("BEGIN", "BEGIN\n  PERFORM 1;");
  expect(changedPlacement).not.toBe(placement.definition);
  const expected = sql`${sql.identifier(schemaName)}.fx_installation_frontier_expected`;
  const result = sql`${sql.identifier(schemaName)}.fx_finite_placement_frontier`;
  const faults = [
    { name: "recreated displaced scoped placement owner", apply: () => persistence.execute(sql`create function
      ${sql.identifier(schemaName)}.fx_lock_read_scope_placement(text,text) returns text language sql as 'select $1'`),
      restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.fx_lock_read_scope_placement(text,text)`) },
    { name: "recreated displaced finite scope owner", apply: () => persistence.execute(sql`create function
      ${sql.identifier(schemaName)}.fx_lock_finite_scope_observation(text) returns text language sql as 'select $1'`),
      restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.fx_lock_finite_scope_observation(text)`) },
    { name: "placement actual body", apply: () => persistence.query(changedPlacement),
      restore: () => persistence.query(placement.definition) },
    { name: "installation helper privilege boundary", apply: () => persistence.execute(sql`alter function ${sql.raw(installation.signature)} security invoker`),
      restore: () => persistence.query(installation.definition) },
    { name: "placement PUBLIC execution", apply: () => persistence.execute(sql`grant execute on function ${sql.raw(placement.signature)} to public`),
      restore: () => persistence.execute(sql`revoke execute on function ${sql.raw(placement.signature)} from public`) },
    { name: "expected identity PUBLIC usage", apply: () => persistence.execute(sql`grant usage on type ${expected} to public`),
      restore: () => persistence.execute(sql`revoke usage on type ${expected} from public`) },
    { name: "capture scalar overload", apply: () => persistence.execute(sql`create function ${sql.identifier(schemaName)}.fx_accept_finite_storage_capture(boolean)
      returns boolean language sql as 'select $1'`),
      restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.fx_accept_finite_storage_capture(boolean)`) },
    { name: "expected identity attribute type", apply: () => persistence.execute(sql`alter type ${expected} alter attribute namespace_oid type integer cascade`),
      restore: () => persistence.execute(sql`alter type ${expected} alter attribute namespace_oid type bigint cascade`) },
    { name: "placement timestamp precision", apply: () => persistence.execute(sql`alter type ${result} alter attribute created_at type timestamptz(0) cascade`),
      restore: () => persistence.execute(sql`alter type ${result} alter attribute created_at type timestamptz cascade`) },
  ];
  for (const fault of faults) {
    await fault.apply();
    try { await expect(migrate(), fault.name).rejects.toMatchObject({ reason: "invalidInstallation" }); }
    finally { await fault.restore(); }
    await migrate();
  }
}
