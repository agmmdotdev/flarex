import { readFile } from "node:fs/promises";
import { sql, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds,
  fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations } from "../../src/database/schema";
import { INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS } from "../../src/storage/indexes/indexMaintenanceInstallation";
import type { ApplicationNativeMutationPersistence } from "../application/applicationNativeMutationTestFixture";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const migrationRoot = new URL("../../drizzle/", import.meta.url);

/** Test-only restoration of the actual predecessor maintenance schema and
 * publication functions. Genuine rows, indexes, App openings and both heads
 * remain; framework builds return to the old per-publication coverage state. */
export async function restoreMaintenanceAuthorityPredecessor(
  persistence: Pick<ApplicationNativeMutationPersistence, "query" | "drizzle">,
  journalSchema = "drizzle",
) {
  const families = [
    { build: fxSystemIndexBuildStates, opening: fxSystemIndexMaintenanceObligations },
    { build: fxSystemUniqueConstraintBuilds, opening: fxSystemUniqueMaintenanceObligations },
  ];
  for (const { build, opening } of families) {
    const buildName = quote(getTableName(build));
    const openingName = quote(getTableName(opening));
    const openingKey = getTableConfig(build).foreignKeys.find(key => key.getName().endsWith("maintenance_opening_fk"));
    const maintenanceCheck = getTableConfig(build).checks.find(check => check.name.endsWith("maintenance_check"));
    if (openingKey === undefined || maintenanceCheck === undefined) throw new Error("Missing maintained build contract");
    await persistence.query(`alter table ${buildName} drop constraint ${quote(openingKey.getName())}, drop constraint ${quote(maintenanceCheck.name)}`);
    // Only fixture-created future binding openings are removed to reconstruct144.
    // Actual retained Application witnesses survive unchanged.
    await persistence.query(`update ${buildName} b set maintenance_activation_sequence=null,
      covered_through_commit_seq=c.last_commit_seq from fx_system_scope_clock c
      where b.scope_id=c.scope_id and b.maintenance_authority_kind='binding'`);
    await persistence.query(`alter table ${openingName} disable trigger fx_maintenance_immutable`);
    try { await persistence.query(`delete from ${openingName} where authority_kind='binding'`); }
    finally { await persistence.query(`alter table ${openingName} enable trigger fx_maintenance_immutable`); }
    const config = getTableConfig(opening);
    for (const key of [...config.primaryKeys, ...config.uniqueConstraints]) {
      await persistence.query(`alter table ${openingName} drop constraint ${quote(key.getName()!)}`);
    }
    await persistence.query(`alter table ${openingName} drop constraint ${quote(config.checks.find(check => check.name.endsWith("owner_check"))!.name)},
      drop column authority_kind, drop column candidate_sha256${opening === fxSystemUniqueMaintenanceObligations ? ", drop column schema_manifest_sha256" : ""}`);
    await persistence.query(`alter table ${buildName} drop column maintenance_authority_kind`);
    for (const key of config.primaryKeys) {
      await persistence.query(`alter table ${openingName} add constraint ${quote(key.getName())} primary key
        (${key.columns.filter(column => column.name !== "authority_kind").map(column => quote(column.name)).join(",")})`);
    }
    for (const key of config.uniqueConstraints) {
      await persistence.query(`alter table ${openingName} add constraint ${quote(key.getName()!)} unique
        (${key.columns.filter(column => column.name !== "authority_kind").map(column => quote(column.name)).join(",")})`);
    }
    const reference = openingKey.reference();
    await persistence.query(`alter table ${buildName} add constraint ${quote(openingKey.getName())} foreign key
      (${reference.columns.filter(column => column.name !== "maintenance_authority_kind").map(column => quote(column.name)).join(",")})
      references ${openingName} (${reference.foreignColumns.filter(column => column.name !== "authority_kind").map(column => quote(column.name)).join(",")})
      on update restrict on delete restrict`);
    await persistence.query(`alter table ${buildName} add constraint ${quote(maintenanceCheck.name)} check
      (maintenance_activation_sequence is null or (maintenance_activation_sequence is not null and maintenance_activation_sequence>0
        and lifecycle='enabled' and covered_through_commit_seq is not null${build === fxSystemIndexBuildStates ? " and first_readable_commit_seq is not null" : ""}))`);
  }
  for (const operation of INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS) {
    await persistence.query(`drop function ${operation.name}(${operation.signature})`);
  }
  const originalPublishers = (await readFile(new URL("0136_typed_maintenance_obligations.sql", migrationRoot), "utf8"))
    .split("--> statement-breakpoint").filter(statement => statement.includes("CREATE FUNCTION %1$I.fx_replace_active_"));
  if (originalPublishers.length !== 2) throw new Error("Missing predecessor Application publication definitions");
  for (const statement of originalPublishers) await persistence.query(statement);
  await persistence.drizzle.transaction(async tx => {
    await tx.execute(sql`update fx_system_installation set state='draining',maintenance_owner=gen_random_uuid(),
      maintenance_pid=pg_backend_pid(),maintenance_backend_start=(select backend_start from pg_stat_activity where pid=pg_backend_pid())`);
    await tx.execute(sql`delete from ${sql.identifier(journalSchema)}.__drizzle_migrations where created_at>=1791590800000`);
  });
}
