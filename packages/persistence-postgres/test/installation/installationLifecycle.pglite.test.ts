import { getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { closeInstallationAdmission, initializeFullProofInstallation, loadManagedInstallation,
  lockInstallationForCurrentTransaction, verifyInstallationWriterProtection } from "../../src/installation/installationLifecycle";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { fxSystemTransactionJournalPoints } from "../../src/database/schema";

describe("installation full-proof compatibility", () => {
  it("attests the journal CHECK and cleans native parser references on nested success and rollback", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    const table = fxSystemTransactionJournalPoints;
    const check = getTableConfig(table).checks.find(value => value.name === "fx_system_tx_journal_point_dependency_check");
    if (check === undefined) throw new Error("Missing actual journal CHECK");
    const references = async () => (await persistence.query(
      "select count(*)::integer as count from pg_class where relnamespace=pg_my_temp_schema() and relname like 'fx_point_dependency_reference_%'"
    )).rows;
    const rollback = new Error("exact cold verification rollback");
    try {
      await persistence.migrate();
      await persistence.drizzle.transaction(async tx => {
        for (let index = 0; index < 2; index += 1) {
          await Effect.runPromise(verifyInstallationWriterProtection(tx, "public"));
          expect((await tx.execute<{ count: number }>(sql`select count(*)::integer as count from pg_class
            where relnamespace=pg_my_temp_schema() and relname like 'fx_point_dependency_reference_%'`)).rows)
            .toEqual([{ count: 0 }]);
        }
      });
      await expect(persistence.drizzle.transaction(async tx => {
        await Effect.runPromise(verifyInstallationWriterProtection(tx, "public"));
        throw rollback;
      })).rejects.toBe(rollback);
      expect(await references()).toEqual([{ count: 0 }]);
      await expect(Effect.runPromise(verifyInstallationWriterProtection(persistence.drizzle, "missing_installation_schema")))
        .rejects.toMatchObject({ reason: "resourceFailure" });
      expect(await references()).toEqual([{ count: 0 }]);
      for (const replacement of [undefined, sql`true`, sql`(${table.dependencyKind} = 'present' and ${table.dependencyRevisionCommitSeq} is not null
        and ${table.dependencyRevisionCommitSeq} >= 1 or ${table.dependencyKind} = 'missing_no_visible_revision')
        and ${table.dependencyRevisionCommitSeq} is null or (${table.dependencyKind} = 'missing_tombstone'
        and ${table.dependencyRevisionCommitSeq} is not null and ${table.dependencyRevisionCommitSeq} >= 1)
        or (${table.dependencyKind} = 'generated_insertion' and ${table.dependencyRevisionCommitSeq} is null)`]) {
        await persistence.drizzle.execute(sql`alter table ${sql.identifier(getTableName(table))}
          drop constraint ${sql.identifier(check.name)}`);
        if (replacement !== undefined) await persistence.drizzle.execute(sql`alter table ${sql.identifier(getTableName(table))}
          add constraint ${sql.identifier(check.name)} check (${replacement})`);
        await persistence.query("update fx_system_installation set state='unverified'");
        await expect(Effect.runPromise(initializeFullProofInstallation(persistence.drizzle, "public")))
          .rejects.toMatchObject({ reason: "invalidInstallation" });
        expect((await persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "unverified" }]);
        expect(await references()).toEqual([{ count: 0 }]);
        if (replacement !== undefined) await persistence.drizzle.execute(sql`alter table ${sql.identifier(getTableName(table))}
          drop constraint ${sql.identifier(check.name)}`);
        await persistence.drizzle.execute(sql`alter table ${sql.identifier(getTableName(table))}
          add constraint ${sql.identifier(check.name)} check (${check.value})`);
        await Effect.runPromise(initializeFullProofInstallation(persistence.drizzle, "public"));
      }
    } finally { await db.close(); }
  }, 180_000);
  it("refuses overlapping complete maintenance commands across wrappers of the actual backend", async () => {
    const db = newTestPGlite();
    const first = await createPGlitePersistence({ db });
    const second = await createPGlitePersistence({ db });
    await first.migrate();
    const query = db.query.bind(db);
    let signalDrained!: () => void;
    let resume!: () => void;
    const drained = new Promise<void>(resolve => { signalDrained = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    const observe = vi.spyOn(db, "query").mockImplementation(async (...args) => {
      const result = await query(...args);
      if (args[0].includes("returning maintenance_owner::text as owner")) {
        signalDrained();
        await held;
      }
      return result;
    });
    const running = first.migrate();
    try {
      await drained;
      const beforeOverlap = await query("select state,maintenance_owner,incarnation,structural_generation from fx_system_installation");
      expect(beforeOverlap.rows).toMatchObject([{ state: "draining", maintenance_owner: expect.any(String) }]);
      const calls = observe.mock.calls.length;
      await expect(second.migrate()).rejects.toMatchObject({ reason: "busy" });
      await expect(first.migrate()).rejects.toMatchObject({ reason: "busy" });
      expect(observe.mock.calls).toHaveLength(calls);
      expect((await query("select state,maintenance_owner,incarnation,structural_generation from fx_system_installation")).rows)
        .toEqual(beforeOverlap.rows);
      resume();
      await running;
      expect((await query("select state,maintenance_owner from fx_system_installation")).rows)
        .toEqual([{ state: "active", maintenance_owner: null }]);
      observe.mockRestore();
      await second.migrate();
    } finally {
      resume();
      await running.catch(() => undefined);
      observe.mockRestore();
      await db.close();
    }
  }, 180_000);

  it.each([
    "maintenance_owner=gen_random_uuid()",
    "incarnation=gen_random_uuid()",
    "structural_generation=structural_generation+1",
  ])("keeps maintenance draining when its exact reopen identity changes: %s", async change => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const query = db.query.bind(db);
    let tampered = false;
    const observe = vi.spyOn(db, "query").mockImplementation(async (...args) => {
      if (args[0].includes("returning 1 as reopened")) {
        await query(`update fx_system_installation set ${change}`);
        tampered = true;
      }
      return query(...args);
    });
    try {
      await expect(persistence.migrate()).rejects.toMatchObject({ reason: "changed" });
      expect(tampered).toBe(true);
      expect((await query("select state,maintenance_owner from fx_system_installation")).rows)
        .toMatchObject([{ state: "draining", maintenance_owner: expect.any(String) }]);
      expect((await query("select count(*)::integer as locks from pg_locks where locktype='advisory' and pid=pg_backend_pid()")).rows)
        .toEqual([{ locks: 0 }]);
      observe.mockRestore();
      await persistence.migrate();
      expect((await query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    } finally {
      observe.mockRestore();
      await db.close();
    }
  }, 180_000);

  it("rejects truncated and malformed actual maintenance gate results before draining", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const query = db.query.bind(db);
    try {
      for (const malformed of ["missingPresence", "missingGate", "schemaAbsent", "oidOverflow", "missingLocks"] as const) {
        const before = (await query("select state,maintenance_owner,incarnation,structural_generation from fx_system_installation")).rows;
        let injected = false;
        const observe = vi.spyOn(db, "query").mockImplementation(async (...args) => {
          const result = await query(...args);
          if (malformed === "missingPresence" && args[0].includes("as installation_presence")) {
            result.rows = [];
            injected = true;
          } else if (malformed === "missingLocks" && args[0].includes("as compatibility_maintenance")) {
            result.rows = [];
            injected = true;
          } else if (malformed !== "missingPresence" && malformed !== "missingLocks" && args[0].includes("join pg_catalog.pg_class c")) {
            if (malformed === "missingGate") result.rows = [];
            else {
              const row: unknown = result.rows[0];
              if (!Array.isArray(row)) throw new Error("Expected actual PGlite array-mode gate row");
              const changed: unknown[] = [...row];
              changed[malformed === "schemaAbsent" ? 1 : 4] = malformed === "schemaAbsent" ? null : "4294967296";
              result.rows = [changed];
            }
            injected = true;
          }
          return result;
        });
        try {
          await expect(persistence.migrate()).rejects.toMatchObject({ reason: malformed === "missingPresence" ? "invalidInstallation" : "invalidCapability" });
          expect(injected).toBe(true);
          expect((await query("select state,maintenance_owner,incarnation,structural_generation from fx_system_installation")).rows).toEqual(before);
          expect((await query("select count(*)::integer as locks from pg_locks where locktype='advisory' and pid=pg_backend_pid()")).rows)
            .toEqual([{ locks: 0 }]);
        } finally { observe.mockRestore(); }
      }
      await persistence.migrate();
    } finally { await db.close(); }
  }, 180_000);

  it("joins the active gate, refuses inactive serving and detects removed writer protection", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await persistence.drizzle.transaction(async tx => {
        await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
        closeInstallationAdmission(tx);
      });
      await expect(Effect.runPromise(loadManagedInstallation(persistence.drizzle, "unpublished", "public")))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
      await persistence.query("update fx_system_installation set state = 'unverified'");
      await expect(persistence.drizzle.transaction(tx => Effect.runPromise(lockInstallationForCurrentTransaction(tx))))
        .rejects.toMatchObject({ reason: "inactive" });
      await expect(persistence.query("update fx_system_scope_execution_authority set epoch = epoch where false"))
        .rejects.toMatchObject({ code: "55000" });
      await Effect.runPromise(initializeFullProofInstallation(persistence.drizzle));
      await persistence.query("drop trigger fx_00_installation_admission on fx_system_scope_clock");
      await expect(Effect.runPromise(verifyInstallationWriterProtection(persistence.drizzle, "public")))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
    } finally { await db.close(); }
  }, 180_000);
});
