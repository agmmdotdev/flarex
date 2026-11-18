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
      and p.proname in ('fx_lock_installation_frontier','fx_lock_control_scope_placement','fx_accept_finite_storage_capture')`)).rows;
  expect(functions).toHaveLength(3);
  expect(functions.every(fn => fn.scalar)).toBe(true);
  expect((await persistence.execute(sql`select count(*)::int as count from pg_catalog.pg_proc p
    where p.pronamespace=${schemaName}::pg_catalog.regnamespace
      and p.proname in ('fx_lock_finite_scope_observation','fx_lock_read_scope_placement','fx_accept_finite_placement_frontier')`)).rows)
    .toEqual([{ count: 0 }]);
  expect((await persistence.execute(sql`select count(*)::int as count from pg_catalog.pg_type t
    where t.typnamespace=${schemaName}::pg_catalog.regnamespace and t.typname='fx_finite_placement_frontier'`)).rows)
    .toEqual([{ count: 0 }]);
  const placement = functions.find(fn => fn.name === "fx_lock_control_scope_placement");
  const installation = functions.find(fn => fn.name === "fx_lock_installation_frontier");
  const capture = functions.find(fn => fn.name === "fx_accept_finite_storage_capture");
  if (placement === undefined || installation === undefined || capture === undefined)
    throw new Error("Missing installed scalar frontier owner");
  const changedPlacement = placement.definition.replace("BEGIN", "BEGIN\n  PERFORM 1;");
  expect(changedPlacement).not.toBe(placement.definition);
  const expected = sql`${sql.identifier(schemaName)}.fx_installation_frontier_expected`;
  const result = sql`${sql.identifier(schemaName)}.fx_control_scope_placement`;
  const readExpected = sql`${sql.identifier(schemaName)}.fx_finite_read_expected`;
  const captureResult = sql`${sql.identifier(schemaName)}.fx_finite_capture_frontier`;
  expect((await persistence.execute(sql`select a.attname as name from pg_catalog.pg_attribute a
    where a.attrelid = (select t.typrelid from pg_catalog.pg_type t where t.oid =
      ${`${schemaName}.fx_finite_capture_frontier`}::pg_catalog.regtype) and a.attnum > 0 and not a.attisdropped
    order by a.attnum`)).rows).toEqual(["reason","database_now_epoch_milliseconds","serving_commit_seq",
      "retained_floor","session_row","body_eligible"].map(name => ({ name })));
  const faults = [
    { name: "recreated displaced dynamic dispatcher", apply: () => persistence.execute(sql`create function
      ${sql.identifier(schemaName)}.fx_accept_finite_placement_frontier(text) returns text language sql as 'select $1'`),
      restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.fx_accept_finite_placement_frontier(text)`) },
    { name: "recreated displaced placement type", apply: () => persistence.execute(sql`create type
      ${sql.identifier(schemaName)}.fx_finite_placement_frontier as (reason text)`),
      restore: () => persistence.execute(sql`drop type ${sql.identifier(schemaName)}.fx_finite_placement_frontier`) },
    { name: "read expected PUBLIC usage", apply: () => persistence.execute(sql`grant usage on type ${readExpected} to public`),
      restore: () => persistence.execute(sql`revoke usage on type ${readExpected} from public`) },
    { name: "read digest expected attribute", apply: () => persistence.execute(sql`alter type ${readExpected} alter attribute manifest_sha256 type text cascade`),
      restore: () => persistence.execute(sql`alter type ${readExpected} alter attribute manifest_sha256 type bytea cascade`) },
    { name: "compact retained floor attribute", apply: () => persistence.execute(sql`alter type ${captureResult} alter attribute retained_floor type integer cascade`),
      restore: () => persistence.execute(sql`alter type ${captureResult} alter attribute retained_floor type bigint cascade`) },
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
