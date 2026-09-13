import { sql } from "drizzle-orm";
import { Schema } from "effect";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";

const decodeEnabledGuards = Schema.decodeUnknownSync(
  Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({ tgname: Schema.String, tgenabled: Schema.Literal("O") }),
    ),
  }),
);

export function administrativelyRepairFrameworkMetadata<Value>(
  database: FlarexMetadataDatabase,
  tableNames: readonly string[],
  repair: (transaction: FlarexMetadataTransaction) => Promise<Value>,
): Promise<Value> {
  return database.transaction((transaction) =>
    withAdministrativeFrameworkMetadataRepair(transaction, tableNames, () =>
      repair(transaction),
    ),
  );
}

/** Privileged fault injection only. The caller must own and settle the transaction.
 * Disabling a guard is deliberately visible at each corruption witness; ordinary
 * installation never receives this capability. ALTERs roll back with the test.
 */
export async function withAdministrativeFrameworkMetadataRepair<Value>(
  transaction: FlarexMetadataTransaction,
  tableNames: readonly string[],
  repair: () => Promise<Value>,
): Promise<Value> {
  const guardsToDisable: {
    readonly table: string;
    readonly trigger: string;
  }[] = [];
  const disabled: { readonly table: string; readonly trigger: string }[] = [];
  for (const name of tableNames) {
    if (
      !/^fx_system_framework_[a-z_]+$/.test(name) &&
      name !== "fx_system_relational_physical_name_assignment"
    ) {
      throw new Error("Administrative witness must name framework metadata.");
    }
    const guards = decodeEnabledGuards(
      await transaction.execute(sql`
      select tgname, tgenabled from pg_catalog.pg_trigger
      where tgrelid = ${name}::regclass and tgname in
        ('fx_framework_history_immutable', 'fx_framework_children_sealed')
      order by tgname
    `),
    );
    if (guards.rows.length === 0) {
      throw new Error(
        "Administrative witness requires enabled metadata guards.",
      );
    }
    for (const guard of guards.rows) {
      guardsToDisable.push({ table: name, trigger: guard.tgname });
    }
  }
  let primaryFailure: { readonly cause: unknown } | undefined;
  try {
    for (const guard of guardsToDisable) {
      await transaction.execute(
        sql`alter table ${sql.identifier(guard.table)} disable trigger ${sql.identifier(guard.trigger)}`,
      );
      disabled.push(guard);
    }
    return await repair();
  } catch (cause) {
    primaryFailure = { cause };
    throw cause;
  } finally {
    try {
      for (const guard of disabled.reverse()) {
        await transaction.execute(
          sql`alter table ${sql.identifier(guard.table)} enable trigger ${sql.identifier(guard.trigger)}`,
        );
      }
    } catch (restorationFailure) {
      // SQL errors can abort the borrowed transaction. Preserve the original
      // failure as well as the failed restoration; its owner still rolls back.
      if (primaryFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.cause, restorationFailure],
          "Administrative repair and guard restoration failed",
        );
      }
      throw restorationFailure;
    }
  }
}
