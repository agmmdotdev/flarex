import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getActivationServingInstallationReferencesResult, InstallationLifecycleError,
  isManagedInstallationTransaction, loadActivationServingInstallation, verifyManagedRuntimePrivileges } from "../src/installationLifecycle";
import { INDEX_MAINTENANCE_BUILD_PERMISSIONS, INDEX_MAINTENANCE_OBLIGATION_TABLES,
  INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS } from "../src/indexMaintenanceInstallation";
import { createPostgresLocatedReadCommittedTransactionRunnerV1 } from "../src/postgresLocatedReadCommitted";
import { publishVerifiedInstallation, withInstallationMaintenance } from "../src/postgresInstallationMaintenance";
import { createActivationServingFileScopedPostgresFixture, postgresUrl,
  type ActivationServingFileScopedPostgresFixture } from "./postgresHelpers";
import type { AppRowTransaction } from "../src/appRows";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL
  ? describe : describe.skip;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const publicationArguments = (ordered: boolean): unknown[] => [
  "scope-with-no-activation", null, null, "1", Buffer.alloc(32), Buffer.alloc(32), null, null,
  ...(ordered ? [null] : []), "[]", "deployment", "schema", ...(ordered ? [Buffer.alloc(32)] : []), "[]",
];
const publicationCall = (schemaName: string, operation: typeof INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS[number]) =>
  `select * from ${quote(schemaName)}.${operation.name}(${operation.signature.split(",")
    .map((type, position) => `$${position + 1}::${type}`).join(",")})`;

native("activation and serving installation identities", () => {
  let fixture: ActivationServingFileScopedPostgresFixture | undefined;
  const installed = (): ActivationServingFileScopedPostgresFixture => {
    if (fixture === undefined) throw new Error("Missing dual installation fixture");
    return fixture;
  };
  beforeAll(async () => { fixture = await createActivationServingFileScopedPostgresFixture(); }, 180_000);
  afterAll(async () => { await fixture?.dispose(); });

  it("issues exact independent logins and admits only the actual activation transaction", async () => {
    const current = installed();
    const references = await Effect.runPromise(Effect.fromResult(getActivationServingInstallationReferencesResult(current.pair)));
    expect(references.serving.database).toBe(current.serving.persistence.drizzle);
    expect(references.activation.database).toBe(current.activation.persistence.drizzle);
    expect(references.serving.installation).toBe(current.serving.installation);
    expect(references.activation.installation).toBe(current.activation.installation);
    expect(current.serving.login).not.toBe(current.activation.login);
    for (const member of [current.serving, current.activation]) {
      expect((await member.persistence.query("select session_user as login, current_user = session_user as direct")).rows)
        .toEqual([{ login: member.login, direct: true }]);
    }
    const run = createPostgresLocatedReadCommittedTransactionRunnerV1(current.activation.persistence.pool,
      { directInstallation: references.activation });
    let admitted: AppRowTransaction | undefined;
    const result = await run(async tx => {
      admitted = tx;
      expect(isManagedInstallationTransaction(tx, references.activation.database, references.activation.installation)).toBe(true);
      expect(isManagedInstallationTransaction(tx, references.serving.database, references.serving.installation)).toBe(false);
      return tx.select({ login: sql<string>`session_user` }).from(sql`(values (1)) as accepted(value)`);
    });
    expect(result).toEqual([{ login: current.activation.login }]);
    if (admitted === undefined) throw new Error("Activation callback did not run");
    expect(isManagedInstallationTransaction(admitted, references.activation.database, references.activation.installation)).toBe(false);
  });

  it("denies ordinary, control and PUBLIC publisher access and raw protected DML", async () => {
    const current = installed();
    for (const operation of INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS) {
      const arguments_ = publicationArguments(operation.name === "fx_replace_active_index_maintenance");
      const statement = publicationCall(current.schemaName, operation);
      for (const member of [current.serving, current.controlRead])
        await expect(member.persistence.query(statement, arguments_)).rejects.toMatchObject({ code: "42501" });
      // Correct activation credentials pass ACL admission; the absent real
      // activation is then refused by the fixed publisher's local row proof.
      await expect(current.activation.persistence.query(statement, arguments_)).rejects.toMatchObject({ code: "FX001" });
      const signature = `${quote(current.schemaName)}.${operation.name}(${operation.signature})`;
      expect((await current.owner.persistence.query(`select not exists (
        select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
        where p.oid = $1::pg_catalog.regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as denied`, [signature])).rows)
        .toEqual([{ denied: true }]);
    }
    for (const member of [current.serving, current.activation, current.controlRead]) {
      for (const table of INDEX_MAINTENANCE_OBLIGATION_TABLES) {
        await expect(member.persistence.query(`insert into ${quote(table)} select * from ${quote(table)} where false`))
          .rejects.toMatchObject({ code: "42501" });
        await expect(member.persistence.query(`update ${quote(table)} set scope_id = scope_id where false`))
          .rejects.toMatchObject({ code: "42501" });
        await expect(member.persistence.query(`delete from ${quote(table)} where false`))
          .rejects.toMatchObject({ code: "42501" });
      }
      await expect(member.persistence.query("insert into fx_system_application_read_binding select * from fx_system_application_read_binding where false"))
        .rejects.toMatchObject({ code: "42501" });
      for (const build of INDEX_MAINTENANCE_BUILD_PERMISSIONS) {
        await expect(member.persistence.query(`update ${quote(build.tableName)} set ${quote(build.bindingColumn)} = null where false`))
          .rejects.toMatchObject({ code: "42501" });
        await expect(member.persistence.query(`insert into ${quote(build.tableName)} (${quote(build.bindingColumn)}) select null where false`))
          .rejects.toMatchObject({ code: "42501" });
      }
    }
    for (const build of INDEX_MAINTENANCE_BUILD_PERMISSIONS) {
      const timestamp = build.writableColumns.find(column => column === "updated_at");
      if (timestamp === undefined) throw new Error("Build has no ordinary timestamp column");
      const statement = `update ${quote(build.tableName)} set ${quote(timestamp)} = ${quote(timestamp)} where false`;
      await current.serving.persistence.query(statement);
      await current.activation.persistence.query(statement);
      await expect(current.controlRead.persistence.query(statement)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("admits bounded ownership reads for activation and serving logins while denying control and PUBLIC", async () => {
    const current = installed();
    const reads = [
      { name: "fx_read_application_write_ownership_snapshot", signature: "text,integer,integer",
        arguments: ["scope-with-no-activation", 64, 1_048_576] },
      { name: "fx_read_application_ownership_manifest", signature: "text,text,integer,integer",
        arguments: ["scope-with-no-activation", "unpublished-revision", 64, 1_048_576] },
    ];
    for (const read of reads) {
      const signature = `${quote(current.schemaName)}.${read.name}(${read.signature})`;
      const statement = `select * from ${quote(current.schemaName)}.${read.name}(${read.signature.split(",")
        .map((type, position) => `$${position + 1}::${type}`).join(",")})`;
      for (const member of [current.serving, current.activation])
        expect((await member.persistence.query(statement, read.arguments)).rows).toEqual([]);
      await expect(current.controlRead.persistence.query(statement, read.arguments)).rejects.toMatchObject({ code: "42501" });
      expect((await current.owner.persistence.query(`select not exists (
        select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
        where p.oid = $1::pg_catalog.regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as denied`, [signature])).rows)
        .toEqual([{ denied: true }]);
    }
    const journal = { schemaName: current.journal.migrationsSchema ?? "drizzle",
      tableName: current.journal.migrationsTable ?? "__drizzle_migrations" };
    for (const { member, profile } of [
      { member: current.serving, profile: "dataRuntime" },
      { member: current.activation, profile: "activationWriter" },
      { member: current.controlRead, profile: "controlRead" },
    ] as const) {
      await Effect.runPromise(verifyManagedRuntimePrivileges(member.persistence.drizzle, current.schemaName, journal, profile));
    }
    const requiredRead = `${quote(current.schemaName)}.fx_read_application_write_ownership_snapshot(text,integer,integer)`;
    try {
      await current.owner.persistence.query(`revoke execute on function ${requiredRead} from ${quote(current.activation.login)}`);
      await expect(Effect.runPromise(verifyManagedRuntimePrivileges(current.activation.persistence.drizzle,
        current.schemaName, journal, "activationWriter"))).rejects.toMatchObject({ reason: "invalidInstallation" });
    } finally {
      await current.owner.persistence.query(`grant execute on function ${requiredRead} to ${quote(current.activation.login)}`);
    }
    await Effect.runPromise(verifyManagedRuntimePrivileges(current.activation.persistence.drizzle,
      current.schemaName, journal, "activationWriter"));
  });

  it("rejects copied capabilities, foreign database objects and genuine mixed namespaces", async () => {
    const current = installed();
    await expect(Effect.runPromise(Effect.fromResult(getActivationServingInstallationReferencesResult(Object.assign({}, current.pair)))))
      .rejects.toMatchObject({ reason: "invalidCapability" });
    const references = await Effect.runPromise(Effect.fromResult(getActivationServingInstallationReferencesResult(current.pair)));
    await expect(Effect.runPromise(loadActivationServingInstallation({ serving: references.serving,
      activation: { ...references.activation, installation: Object.assign({}, references.activation.installation) } })))
      .rejects.toMatchObject({ reason: "invalidCapability" });
    await expect(Effect.runPromise(loadActivationServingInstallation({
      serving: { ...references.serving, database: references.activation.database }, activation: references.activation })))
      .rejects.toMatchObject({ reason: "invalidCapability" });
    const other = await createActivationServingFileScopedPostgresFixture();
    try {
      await expect(Effect.runPromise(loadActivationServingInstallation({ serving: references.serving,
        activation: { database: other.activation.persistence.drizzle, installation: other.activation.installation } })))
        .rejects.toMatchObject({ reason: "changed" });
    } finally { await other.dispose(); }
  }, 180_000);

  it("refuses incoming role membership before publishing activation credentials", async () => {
    const current = installed();
    const activationPolicy = current.runtimePolicies.find(policy => policy.accessProfile === "activationWriter");
    if (activationPolicy === undefined) throw new Error("Missing genuine activation policy");
    try {
      await expect(Effect.runPromise(withInstallationMaintenance(current.owner.persistence.pool.options, current.schemaName, handle =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({ try: () => current.setIncomingActivationMembership(true),
            catch: cause => new InstallationLifecycleError({ reason: "resourceFailure", cause }) });
          // Verify activation first, so this specifically exercises incoming
          // membership rather than serving's existing outgoing-membership gate.
          yield* publishVerifiedInstallation(handle, [activationPolicy], current.journal);
        })))).rejects.toMatchObject({ reason: "invalidInstallation" });
      expect((await current.owner.persistence.query("select state from fx_system_installation")).rows)
        .toEqual([{ state: "draining" }]);
    } finally {
      await current.setIncomingActivationMembership(false);
      await Effect.runPromise(withInstallationMaintenance(current.owner.persistence.pool.options, current.schemaName, handle =>
        publishVerifiedInstallation(handle, current.runtimePolicies, current.journal)));
    }
    const refreshed = await current.reload();
    expect(refreshed.pair).not.toBe(current.pair);
  }, 180_000);

  it("refuses stale preparation through fresh admission before the accepting body", async () => {
    const current = installed();
    const prepared = await current.reload();
    const references = await Effect.runPromise(Effect.fromResult(getActivationServingInstallationReferencesResult(prepared.pair)));
    const run = createPostgresLocatedReadCommittedTransactionRunnerV1(current.activation.persistence.pool,
      { directInstallation: references.activation });
    await Effect.runPromise(withInstallationMaintenance(current.owner.persistence.pool.options, current.schemaName, handle =>
      publishVerifiedInstallation(handle, current.runtimePolicies, current.journal)));
    let entered = false;
    await expect(run(async () => { entered = true; })).rejects.toMatchObject({
      issue: { kind: "infrastructureFailure", phase: "beginOrConfigure" },
    });
    expect(entered).toBe(false);
    await expect(Effect.runPromise(loadActivationServingInstallation(references)))
      .rejects.toMatchObject({ _tag: "InstallationLifecycleError" });
  }, 180_000);
});
