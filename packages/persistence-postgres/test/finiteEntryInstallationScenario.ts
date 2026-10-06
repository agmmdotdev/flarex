import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { FlarexSqlClient } from "../src";
import { fxSystemTransactionSessions } from "../src/schema";

/** Fault the actual installed catalog and exercise its genuine publication
 * gate. Restore captured catalog definitions, never a test-owned verifier. */
export async function finiteEntryInstallationScenario(
  persistence: Pick<FlarexSqlClient, "query" | "execute">,
  schemaName: string, migrate: () => Promise<void>,
): Promise<void> {
  await migrate();
  const functions = (await persistence.execute<{ name: string; signature: string; definition: string }>(sql`
    select p.proname as name, p.oid::pg_catalog.regprocedure::text as signature,
      pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p where p.pronamespace = ${schemaName}::pg_catalog.regnamespace
      and p.proname in ('fx_complete_finite_entry','fx_compare_finite_metadata',
        'fx_accept_app_index_transitions','fx_accept_app_unique_owners',
        'fx_apply_app_unique_mutations','fx_reset_app_index_validation','fx_apply_app_materialization')`)).rows;
  expect(functions).toHaveLength(7);
  const complete = functions.find(fn => fn.name === "fx_complete_finite_entry");
  const compare = functions.find(fn => fn.name === "fx_compare_finite_metadata");
  if (complete === undefined || compare === undefined) throw new Error("Missing actual finite installation functions");
  const materializationFunctions = functions.filter(fn => fn.name !== complete.name && fn.name !== compare.name);
  const compositor = materializationFunctions.find(fn => fn.name === "fx_apply_app_materialization");
  if (compositor === undefined) throw new Error("Missing actual materialization compositor");
  const expectedType = sql`${sql.identifier(schemaName)}.fx_finite_entry_expected`;
  const attribute = fxSystemTransactionSessions.createdAt.name;
  const [originalAttribute] = (await persistence.execute<{ type: string; typmod: number }>(sql`
    select pg_catalog.format_type(a.atttypid,a.atttypmod) as type, a.atttypmod as typmod
    from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.typrelid = a.attrelid
    where t.typnamespace = ${schemaName}::pg_catalog.regnamespace and t.typname = 'fx_finite_entry_expected'
      and a.attname = ${attribute} and not a.attisdropped`)).rows;
  if (originalAttribute === undefined) throw new Error("Missing actual finite expected attribute");
  expect(originalAttribute.typmod).toBe(-1);
  const changedBody = compare.definition.replace("WHERE reason IS NOT NULL", "WHERE false");
  expect(changedBody).not.toBe(compare.definition);
  const changedCompositorBody = compositor.definition.replace("BEGIN", "BEGIN\n  PERFORM 1;");
  expect(changedCompositorBody).not.toBe(compositor.definition);
  const faults = [
    { name: "actual comparator body", apply: () => persistence.query(changedBody),
      restore: () => persistence.query(compare.definition) },
    { name: "completion SECURITY DEFINER", apply: () => persistence.execute(sql`alter function ${sql.raw(complete.signature)} security definer`),
      restore: () => persistence.query(complete.definition) },
    { name: "completion search path", apply: () => persistence.execute(sql`alter function ${sql.raw(complete.signature)} set search_path = public`),
      restore: () => persistence.query(complete.definition) },
    { name: "comparator overload", apply: () => persistence.execute(sql`create function ${sql.identifier(schemaName)}.fx_compare_finite_metadata(boolean)
      returns boolean language sql as 'select $1'`),
      restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.fx_compare_finite_metadata(boolean)`) },
    { name: "expected timestamp typmod", apply: () => persistence.execute(sql`alter type ${expectedType}
      alter attribute ${sql.identifier(attribute)} type timestamp(0) with time zone cascade`),
      restore: () => persistence.execute(sql`alter type ${expectedType}
        alter attribute ${sql.identifier(attribute)} type ${sql.raw(originalAttribute.type)} cascade`) },
    { name: "expected attribute name", apply: () => persistence.execute(sql`alter type ${expectedType}
      rename attribute ${sql.identifier(attribute)} to misplaced_created_at`),
      restore: () => persistence.execute(sql`alter type ${expectedType} rename attribute misplaced_created_at to ${sql.identifier(attribute)}`) },
    { name: "expected attribute type", apply: () => persistence.execute(sql`alter type ${expectedType}
      alter attribute ${sql.identifier(attribute)} type text cascade`),
      restore: () => persistence.execute(sql`alter type ${expectedType}
        alter attribute ${sql.identifier(attribute)} type ${sql.raw(originalAttribute.type)} cascade`) },
    ...materializationFunctions.map(fn => ({ name: `${fn.name} volatility`,
      apply: () => persistence.execute(sql`alter function ${sql.raw(fn.signature)} immutable`),
      restore: () => persistence.query(fn.definition) })),
    ...materializationFunctions.filter(fn => fn.name.startsWith("fx_accept_app_")).flatMap(fn => {
      const changedBody = fn.definition.replace("BEGIN", "BEGIN\n  PERFORM 1;");
      expect(changedBody).not.toBe(fn.definition);
      return [
        { name: `${fn.name} actual body`, apply: () => persistence.query(changedBody),
          restore: () => persistence.query(fn.definition) },
        { name: `${fn.name} SECURITY DEFINER`,
          apply: () => persistence.execute(sql`alter function ${sql.raw(fn.signature)} security definer`),
          restore: () => persistence.query(fn.definition) },
        { name: `${fn.name} overload`,
          apply: () => persistence.execute(sql`create function ${sql.identifier(schemaName)}.${sql.identifier(fn.name)}(boolean)
            returns boolean language sql as 'select $1'`),
          restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.${sql.identifier(fn.name)}(boolean)`) },
      ];
    }),
    { name: "actual materialization body", apply: () => persistence.query(changedCompositorBody),
      restore: () => persistence.query(compositor.definition) },
    { name: "materialization overload", apply: () => persistence.execute(sql`create function ${sql.identifier(schemaName)}.fx_apply_app_materialization(boolean)
      returns boolean language sql as 'select $1'`),
      restore: () => persistence.execute(sql`drop function ${sql.identifier(schemaName)}.fx_apply_app_materialization(boolean)`) },
  ];
  for (const fault of faults) {
    await fault.apply();
    try { await expect(migrate(), fault.name).rejects.toMatchObject({ reason: "invalidInstallation" }); }
    finally { await fault.restore(); }
    await migrate();
  }
}
