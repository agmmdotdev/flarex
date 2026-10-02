import { Client } from "pg";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { getFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/read";
import { installRetainedPhysicalProfile, publishFullProofInstallation, withInstallationMaintenance } from "../src/postgresInstallationMaintenance";
import { postgresUrl } from "./postgresHelpers";
import { installPayloadPreferenceFixture } from "./payloadPreferenceFixture";
import { runEffect } from "./effectTestRuntime";
import { withRetainedPhysicalFixture, quotePhysicalIdentifier, physicalLedger, physicalSettlementLedger,
  waitForPhysicalReceiptWaiter, assertPhysicalPredecessorClosed } from "./retainedPhysicalInstallationFixture";
import { runRetainedPhysicalWorker } from "./retainedPhysicalInstallationRestartTestSupport";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
const quote = quotePhysicalIdentifier;
const withPhysicalFixture = withRetainedPhysicalFixture;

native("retained physical installation through dedicated maintenance", () => {
  it("refuses runtime DDL authority before changing an installed namespace", async () => {
    await withPhysicalFixture(async fixture => {
      await fixture.install();
      const committed = await physicalLedger(fixture);
      await expect(fixture.runtime.persistence.query("create table runtime_ddl_probe (id integer)"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(fixture.runtime.persistence.query("alter table fx_system_framework_migration_step_receipt disable trigger fx_00_installation_admission"))
        .rejects.toMatchObject({ code: "42501" });
      expect((await fixture.owner.persistence.query("select to_regclass('runtime_ddl_probe') as relation")).rows).toEqual([{ relation: null }]);
      expect(await physicalLedger(fixture)).toEqual(committed);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    });
  }, 180_000);

  it("installs the actual Payload fixture, replays receipts, protects new writers and reopens", async () => {
    await withPhysicalFixture(async fixture => {
      const installed = await installPayloadPreferenceFixture(fixture.runtime.persistence, fixture.target, "physical-test");
      const table = installed.availability.installation.plan.plan.physicalLayout.frame.tables[0];
      if (table === undefined) throw new Error("Missing installed table");
      const relation = `${quote(fixture.owner.schemaName)}.${quote(table.name)}`;
      const receipts = (await fixture.owner.persistence.query<{ count: number }>(
        "select count(*)::integer as count from fx_system_framework_migration_step_receipt")).rows[0]?.count;
      expect(receipts).toBeGreaterThan(0);
      expect((await fixture.runtime.persistence.query(`select pg_catalog.has_table_privilege(session_user, $1, 'TRUNCATE') as truncate,
        pg_catalog.has_table_privilege(session_user, $1, 'TRIGGER') as trigger`, [relation])).rows)
        .toEqual([{ truncate: false, trigger: false }]);
      expect((await fixture.owner.persistence.query(`select t.tgtype::integer as bits, t.tgenabled as enabled,
        p.proname as function from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = $1::pg_catalog.regclass and t.tgname = 'fx_00_installation_admission'`, [relation])).rows)
        .toEqual([{ bits: 62, enabled: "O", function: "fx_require_active_installation" }]);
      await fixture.runtime.persistence.query(`delete from ${relation} where false`);
      await runEffect(withInstallationMaintenance(fixture.owner.persistence.pool.options, fixture.owner.schemaName, handle => Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => expect(runEffect(getFrameworkSchemaArtifactEffect(fixture.repository, fixture.profile.artifact.identity)))
          .rejects.toMatchObject({ _tag: "FrameworkSchemaArtifactError", cause: { cause: { reason: "busy" } } }),
          catch: cause => new Error("Ordinary artifact reader bypassed installation maintenance", { cause }) });
        yield* Effect.tryPromise({ try: () => expect(fixture.runtime.persistence.query(`delete from ${relation} where false`))
          .rejects.toMatchObject({ code: "55P03" }), catch: cause => new Error("New physical table admitted a maintenance-time writer", { cause }) });
        yield* publishFullProofInstallation(handle, fixture.journal);
      })));
      await fixture.install();
      expect((await fixture.owner.persistence.query<{ count: number }>(
        "select count(*)::integer as count from fx_system_framework_migration_step_receipt")).rows[0]?.count).toBe(receipts);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    });
  }, 180_000);

  it("refuses corrupt original sealing protection and leaves the namespace draining", async () => {
    await withPhysicalFixture(async fixture => {
      const relation = "fx_system_framework_migration_plan_step";
      await fixture.owner.persistence.query(`alter table ${relation} disable trigger fx_framework_children_sealed`);
      await expect(fixture.install()).rejects.toMatchObject({ _tag: "FrameworkSchemaArtifactError", operation: "read",
        cause: { _tag: "CatalogControlSessionResourceIssue", cause: { _tag: "FrameworkMigrationSessionResourceIssue" } } });
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      expect((await fixture.owner.persistence.query("select count(*)::integer as count from fx_system_framework_migration_step_receipt")).rows)
        .toEqual([{ count: 0 }]);
      await fixture.owner.persistence.query(`alter table ${relation} enable trigger fx_framework_children_sealed`);
      await fixture.install();
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    });
  }, 180_000);

  it("closes an uncertain predecessor before successor replay and prevents late DDL", async () => {
    await withPhysicalFixture(async fixture => {
      let created = false, lost = false;
      let predecessor: Client | undefined;
      await expect(fixture.install({ observe: event => {
        if (!(event.client instanceof Client) || "release" in event.client) throw new Error("Maintenance fixture did not use a dedicated Client");
        predecessor = event.client;
        if (event.phase === "work" && event.edge === "after" && /^create table\b/i.test(event.text?.trim() ?? "")) created = true;
        if (created && !lost && event.phase === "commit" && event.edge === "after") {
          lost = true;
          throw new Error("Lost committed physical-step response");
        }
      } })).rejects.toBeDefined();
      expect(created).toBe(true);
      expect(lost).toBe(true);
      if (predecessor === undefined) throw new Error("Missing predecessor transport witness");
      await expect(predecessor.query("create table late_physical_predecessor (id integer)")).rejects.toBeDefined();
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      const prefix = (await fixture.owner.persistence.query<{ count: number }>(
        "select count(*)::integer as count from fx_system_framework_migration_step_receipt")).rows[0]?.count;
      expect(prefix).toBeGreaterThan(0);
      const recovered = await fixture.install();
      expect(recovered.installation.plan.plan.physicalLayout.frame.tables.length).toBeGreaterThan(0);
      expect((await fixture.owner.persistence.query("select to_regclass('late_physical_predecessor') as relation")).rows)
        .toEqual([{ relation: null }]);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    });
  }, 180_000);

  it.each([
    ["structure", "before"], ["structure", "after"], ["readiness", "before"], ["readiness", "after"],
  ] as const)("reconstructs %s after %s-COMMIT response loss on a successor generation", async (stage, edge) => {
    await withPhysicalFixture(async fixture => {
      let selected = false, faulted = false;
      let predecessor: Client | undefined;
      const failed = await Effect.runPromiseExit(fixture.operation({ observe: event => {
        if (!(event.client instanceof Client) || "release" in event.client) throw new Error("Expected dedicated maintenance backend");
        predecessor = event.client;
        if (event.phase === "begin" && event.edge === "before") selected = false;
        if (event.phase === "work" && event.edge === "after" && (stage === "structure"
          ? /^create table\b/i.test(event.text?.trim() ?? "")
          : /^insert into\b/i.test(event.text?.trim() ?? "") && event.text?.includes('"fx_system_framework_schema_availability_head"'))) selected = true;
        if (selected && !faulted && event.phase === "commit" && event.edge === edge) {
          faulted = true;
          throw new Error(`Injected ${stage} ${edge}-COMMIT response loss`);
        }
      } }));
      expect(faulted).toBe(true);
      expect(Exit.isFailure(failed)).toBe(true);
      await assertPhysicalPredecessorClosed(fixture, predecessor);
      const prefix = await physicalLedger(fixture);
      expect(prefix.receipts).toHaveLength(stage === "structure" ? edge === "before" ? 0 : 1 : fixture.requiredStepCount);
      expect(prefix.publications).toEqual([{ installation: stage === "readiness" && edge === "after" ? 1 : 0,
        readiness: stage === "readiness" && edge === "after" ? 1 : 0, history: stage === "readiness" && edge === "after" ? 1 : 0,
        head: stage === "readiness" && edge === "after" ? 1 : 0 }]);
      const generation = (await fixture.owner.persistence.query<{ state: string; generation: string }>(
        "select state, structural_generation::text as generation from fx_system_installation")).rows[0];
      expect(generation?.state).toBe("draining");
      await fixture.install();
      const completed = await physicalLedger(fixture);
      expect(completed.receipts).toHaveLength(fixture.requiredStepCount);
      expect(completed.receipts.slice(0, prefix.receipts.length)).toEqual(prefix.receipts);
      expect(completed.publications).toEqual([{ installation: 1, readiness: 1, history: 1, head: 1 }]);
      expect((await fixture.owner.persistence.query<{ state: string; generation: string }>(
        "select state, structural_generation::text as generation from fx_system_installation")).rows)
        .toEqual([{ state: "active", generation: String(BigInt(generation?.generation ?? "0") + 1n) }]);
      await fixture.install();
      expect(await physicalLedger(fixture)).toEqual(completed);
    });
  }, 180_000);

  it("rolls back physical DDL, receipt, event and head together on a receipt publication fault", async () => {
    await withPhysicalFixture(async fixture => {
      let faulted = false;
      let before: ReturnType<typeof physicalSettlementLedger> | undefined;
      let predecessor: Client | undefined;
      const failed = await Effect.runPromiseExit(fixture.operation({ observe: event => {
        if (!(event.client instanceof Client)) throw new Error("Expected dedicated Client");
        predecessor = event.client;
        if (before === undefined && event.phase === "work" && event.edge === "before" && /^create table\b/i.test(event.text?.trim() ?? ""))
          before = physicalSettlementLedger(fixture);
        if (!faulted && event.phase === "work" && event.edge === "after" &&
          /^insert into\b/i.test(event.text?.trim() ?? "") && event.text?.includes('"fx_system_framework_migration_step_receipt"')) {
          faulted = true;
          throw new Error("Injected receipt before event/head failure");
        }
      } }));
      expect(faulted).toBe(true);
      expect(Exit.isFailure(failed)).toBe(true);
      await assertPhysicalPredecessorClosed(fixture, predecessor);
      if (before === undefined) throw new Error("Missing committed structural ledger baseline");
      expect(await physicalSettlementLedger(fixture)).toEqual(await before);
      expect((await fixture.owner.persistence.query(`select count(*)::integer as count from pg_catalog.pg_class
        where relnamespace=$1::regnamespace and relname like 'fxrt_%'`, [fixture.owner.schemaName])).rows).toEqual([{ count: 0 }]);
      expect((await fixture.owner.persistence.query("select completed_step_count, last_receipt_storage_id from fx_system_framework_migration_collision_head")).rows)
        .toEqual([{ completed_step_count: 0, last_receipt_storage_id: null }]);
      expect((await fixture.owner.persistence.query("select count(*)::integer as count from fx_system_framework_migration_event where event_kind='stepCompleted'")).rows)
        .toEqual([{ count: 0 }]);
      await fixture.install();
      expect((await physicalLedger(fixture)).receipts).toHaveLength(fixture.requiredStepCount);
    });
  }, 180_000);

  it.each(["interrupt", "timeout"] as const)("settles a real blocked receipt INSERT on %s, closes its exact backend and resumes", async mode => {
    await withPhysicalFixture(async fixture => {
      const blocker = await fixture.owner.persistence.pool.connect();
      const controller = new AbortController();
      let predecessor: Client | undefined;
      let pid: number | undefined;
      let running: ReturnType<typeof Effect.runPromiseExit> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query("lock table fx_system_framework_migration_step_receipt in share mode");
        running = Effect.runPromiseExit(fixture.operation({ transactionTimeoutMilliseconds: mode === "timeout" ? 2_000 : 30_000,
          cleanupTimeoutMilliseconds: 3_000, observe: event => {
            if (!(event.client instanceof Client)) throw new Error("Expected dedicated Client");
            predecessor = event.client;
            const observed: unknown = Reflect.get(event.client, "processID");
            if (typeof observed === "number") pid = observed;
          } }, { lockTimeoutMilliseconds: 10_000, statementTimeoutMilliseconds: 10_000 }), { signal: controller.signal });
        // PID is captured synchronously by the first observer, after owner admission.
        const started = performance.now();
        while (pid === undefined && performance.now() - started < 5_000) await new Promise<void>(resolve => { setTimeout(resolve, 10); });
        await waitForPhysicalReceiptWaiter(fixture, pid);
        const settling = performance.now();
        if (mode === "interrupt") controller.abort();
        const exit = await running;
        expect(Exit.isFailure(exit)).toBe(true);
        expect(performance.now() - settling).toBeLessThan(5_000);
        await assertPhysicalPredecessorClosed(fixture, predecessor);
        expect((await physicalLedger(fixture)).receipts).toHaveLength(0);
        expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      } finally {
        controller.abort();
        await blocker.query("rollback");
        if (running !== undefined) await running;
        blocker.release();
      }
      await fixture.install();
      expect((await physicalLedger(fixture)).receipts).toHaveLength(fixture.requiredStepCount);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    });
  }, 180_000);

  it("admits one same-namespace owner while another namespace completes despite a blocked install", async () => {
    await withPhysicalFixture(async fixture => {
      await withPhysicalFixture(async independent => {
        const blocker = await fixture.owner.persistence.pool.connect();
        let pid: number | undefined;
        let first: Promise<unknown> | undefined;
        try {
          await blocker.query("begin");
          await blocker.query("lock table fx_system_framework_migration_step_receipt in share mode");
          first = runEffect(fixture.operation({ observe: event => {
            const observed: unknown = Reflect.get(event.client, "processID");
            if (typeof observed === "number") pid = observed;
          } }, { lockTimeoutMilliseconds: 10_000 }));
          const started = performance.now();
          while (pid === undefined && performance.now() - started < 5_000) await new Promise<void>(resolve => { setTimeout(resolve, 10); });
          await waitForPhysicalReceiptWaiter(fixture, pid);
          const competing = await Effect.runPromiseExit(fixture.operation());
          expect(Exit.isFailure(competing) && Cause.findErrorOption(competing.cause))
            .toMatchObject({ _tag: "Some", value: { _tag: "InstallationLifecycleError", reason: "busy" } });
          await independent.install();
          expect((await physicalLedger(independent)).publications).toEqual([{ installation: 1, readiness: 1, history: 1, head: 1 }]);
          expect((await physicalLedger(fixture)).receipts).toHaveLength(0);
          await blocker.query("commit");
          await first;
          const completed = await physicalLedger(fixture);
          await fixture.install();
          expect(await physicalLedger(fixture)).toEqual(completed);
        } finally {
          await blocker.query("rollback");
          if (first !== undefined) await first;
          blocker.release();
        }
      });
    });
  }, 180_000);

  it.each(["body", "arguments"] as const)("refuses altered original guard %s before canonical installation and reopens only after restoration", async alteration => {
    await withPhysicalFixture(async fixture => {
      const original = alteration === "body"
        ? (await fixture.owner.persistence.query<{ definition: string }>("select pg_get_functiondef('fx_framework_stamp_creation_transaction()'::regprocedure) as definition")).rows[0]?.definition
        : (await fixture.owner.persistence.query<{ definition: string }>(`select pg_get_triggerdef(oid) as definition from pg_trigger
          where tgrelid='fx_system_framework_migration_plan_step'::regclass and tgname='fx_framework_children_sealed'`)).rows[0]?.definition;
      if (original === undefined) throw new Error("Missing original framework guard definition");
      if (alteration === "body") await fixture.owner.persistence.query(`create or replace function fx_framework_stamp_creation_transaction()
        returns trigger language plpgsql set search_path=pg_catalog as $$ begin return new; end; $$`);
      else {
        await fixture.owner.persistence.query("drop trigger fx_framework_children_sealed on fx_system_framework_migration_plan_step");
        await fixture.owner.persistence.query(`create trigger fx_framework_children_sealed after insert on fx_system_framework_migration_plan_step
          for each row execute function fx_framework_require_creation_transaction('fx_system_framework_migration_plan', 'step_storage_id')`);
      }
      try {
        await expect(fixture.install()).rejects.toMatchObject({ _tag: "FrameworkSchemaArtifactError", operation: "read",
          cause: { _tag: "CatalogControlSessionResourceIssue", cause: { _tag: "FrameworkMigrationSessionResourceIssue" } } });
        expect((await physicalLedger(fixture)).receipts).toHaveLength(0);
        expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      } finally {
        if (alteration === "arguments") await fixture.owner.persistence.query("drop trigger fx_framework_children_sealed on fx_system_framework_migration_plan_step");
        await fixture.owner.persistence.query(original);
      }
      await fixture.install();
      expect((await physicalLedger(fixture)).publications).toEqual([{ installation: 1, readiness: 1, history: 1, head: 1 }]);
    });
  }, 180_000);

  it.each(["before-structure", "after-structure", "after-readiness"] as const)("reconstructs the original namespace in a fresh OS process after %s crash", async mode => {
    await withPhysicalFixture(async fixture => {
      const crashed = await runRetainedPhysicalWorker(fixture, mode);
      expect(crashed.code, crashed.output).not.toBe(0);
      expect(crashed.output).toContain(`RETAINED_PHYSICAL_CRASH:${mode}`);
      await assertPhysicalPredecessorClosed(fixture);
      const prefix = await physicalLedger(fixture);
      expect(prefix.receipts).toHaveLength(mode === "before-structure" ? 0 : mode === "after-structure" ? 1 : fixture.requiredStepCount);
      expect(prefix.publications).toEqual([{ installation: mode === "after-readiness" ? 1 : 0,
        readiness: mode === "after-readiness" ? 1 : 0, history: mode === "after-readiness" ? 1 : 0, head: mode === "after-readiness" ? 1 : 0 }]);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      const resumed = await runRetainedPhysicalWorker(fixture, "resume");
      expect(resumed.code, resumed.output).toBe(0);
      const completed = await physicalLedger(fixture);
      expect(completed.receipts).toHaveLength(fixture.requiredStepCount);
      expect(completed.receipts.slice(0, prefix.receipts.length)).toEqual(prefix.receipts);
      expect(completed.publications).toEqual([{ installation: 1, readiness: 1, history: 1, head: 1 }]);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    });
  }, 300_000);

  it("refuses a foreign target namespace before maintenance changes durable state", async () => {
    await withPhysicalFixture(async fixture => {
      const before = await physicalSettlementLedger(fixture);
      const installation = (await fixture.owner.persistence.query("select to_jsonb(i) as row from fx_system_installation i")).rows;
      await expect(runEffect(installRetainedPhysicalProfile({ config: fixture.owner.persistence.pool.options,
        schemaName: `${fixture.owner.schemaName}_foreign`, database: fixture.runtime.persistence.drizzle,
        target: fixture.target, artifactRepository: fixture.repository, requests: [fixture.request],
        policy: { leaseDurationMilliseconds: 120_000, lockTimeoutMilliseconds: 2_000,
          statementTimeoutMilliseconds: 10_000, runTimeoutMilliseconds: 120_000, maximumStepsPerCall: 128 },
        journal: fixture.journal }))).rejects.toMatchObject({ _tag: "InstallationLifecycleError", reason: "invalidCapability" });
      expect(await physicalSettlementLedger(fixture)).toEqual(before);
      expect((await fixture.owner.persistence.query("select to_jsonb(i) as row from fx_system_installation i")).rows).toEqual(installation);
    });
  }, 180_000);

  it("preserves the original receipt failure when rollback also fails and destroys its backend", async () => {
    await withPhysicalFixture(async fixture => {
      let faulted = false, rollbackFailed = false;
      let predecessor: Client | undefined;
      let before: ReturnType<typeof physicalSettlementLedger> | undefined;
      const failed = await Effect.runPromiseExit(fixture.operation({ observe: event => {
        predecessor = event.client;
        if (before === undefined && event.phase === "work" && event.edge === "before" && /^create table\b/i.test(event.text?.trim() ?? ""))
          before = physicalSettlementLedger(fixture);
        if (!faulted && event.phase === "work" && event.edge === "after" &&
          /^insert into\b/i.test(event.text?.trim() ?? "") && event.text?.includes('"fx_system_framework_migration_step_receipt"')) {
          faulted = true;
          throw new Error("Original retained receipt failure");
        }
        if (faulted && !rollbackFailed && event.phase === "rollback" && event.edge === "before") {
          rollbackFailed = true;
          throw new Error("Retained rollback transport failure");
        }
      } }));
      expect(faulted && rollbackFailed).toBe(true);
      if (!Exit.isFailure(failed)) throw new Error("Expected retained installation failure");
      const rendered = Cause.pretty(failed.cause);
      expect(rendered).toContain("Original retained receipt failure");
      expect(rendered).toContain("Retained rollback transport failure");
      await assertPhysicalPredecessorClosed(fixture, predecessor);
      if (before === undefined) throw new Error("Missing structural settlement baseline");
      expect(await physicalSettlementLedger(fixture)).toEqual(await before);
      await fixture.install();
      expect((await physicalLedger(fixture)).receipts).toHaveLength(fixture.requiredStepCount);
    });
  }, 180_000);

  it("keeps a committed structural prefix after post-COMMIT interruption and resumes publication", async () => {
    await withPhysicalFixture(async fixture => {
      const controller = new AbortController();
      let selected = false, interrupted = false;
      let predecessor: Client | undefined;
      const failed = await Effect.runPromiseExit(fixture.operation({ observe: event => {
        predecessor = event.client;
        if (event.phase === "begin" && event.edge === "before") selected = false;
        if (event.phase === "work" && event.edge === "after" && /^create table\b/i.test(event.text?.trim() ?? "")) selected = true;
        if (selected && !interrupted && event.phase === "commit" && event.edge === "after") {
          interrupted = true;
          controller.abort();
        }
      } }), { signal: controller.signal });
      expect(interrupted).toBe(true);
      expect(Exit.isFailure(failed)).toBe(true);
      await assertPhysicalPredecessorClosed(fixture, predecessor);
      const prefix = await physicalLedger(fixture);
      expect(prefix.receipts).toHaveLength(1);
      expect(prefix.publications).toEqual([{ installation: 0, readiness: 0, history: 0, head: 0 }]);
      expect((await fixture.owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      await fixture.install();
      const completed = await physicalLedger(fixture);
      expect(completed.receipts).toHaveLength(fixture.requiredStepCount);
      expect(completed.receipts.slice(0, prefix.receipts.length)).toEqual(prefix.receipts);
      expect(completed.publications).toEqual([{ installation: 1, readiness: 1, history: 1, head: 1 }]);
    });
  }, 180_000);

  it("bounds an actual deferred COMMIT lock wait and prevents a predecessor from committing late", async () => {
    await withPhysicalFixture(async fixture => {
      // A test-owned internal FK supplies a real deferred COMMIT lock without
      // changing the original external history, sealing or admission guards.
      const probe = `${quote(fixture.owner.migrationsSchema)}.${quote("retained_physical_commit_probe")}`;
      await fixture.owner.persistence.query(`create table ${probe} (id text collate "C" primary key)`);
      await fixture.owner.persistence.query(`insert into ${probe} values ($1)`, [fixture.request.attemptId]);
      await fixture.owner.persistence.query(`alter table fx_system_framework_migration_step_receipt
        add constraint retained_physical_commit_wait foreign key (attempt_id) references ${probe}(id) deferrable initially deferred`);
      const blocker = await fixture.owner.persistence.pool.connect();
      let predecessor: Client | undefined;
      let pid: number | undefined;
      let running: ReturnType<typeof Effect.runPromiseExit> | undefined;
      let before: ReturnType<typeof physicalSettlementLedger> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query(`select id from ${probe} where id=$1 for update`, [fixture.request.attemptId]);
        running = Effect.runPromiseExit(fixture.operation({ transactionTimeoutMilliseconds: 2_000, cleanupTimeoutMilliseconds: 3_000,
          observe: event => {
            predecessor = event.client;
            const observed: unknown = Reflect.get(event.client, "processID");
            if (typeof observed === "number") pid = observed;
            if (before === undefined && event.phase === "work" && event.edge === "before" && /^create table\b/i.test(event.text?.trim() ?? ""))
              before = physicalSettlementLedger(fixture);
          } }, { lockTimeoutMilliseconds: 10_000, statementTimeoutMilliseconds: 10_000 }));
        const deadline = performance.now() + 5_000;
        let waiting = false;
        while (performance.now() < deadline) {
          const observed = await fixture.owner.persistence.query(`select 1 from pg_stat_activity
            where pid=$1 and wait_event_type='Lock' and query='commit'`, [pid]);
          if (observed.rows.length === 1) { waiting = true; break; }
          await new Promise<void>(resolve => { setTimeout(resolve, 10); });
        }
        expect(waiting).toBe(true);
        const settling = performance.now();
        expect(Exit.isFailure(await running)).toBe(true);
        expect(performance.now() - settling).toBeLessThan(5_000);
        await assertPhysicalPredecessorClosed(fixture, predecessor);
        if (before === undefined) throw new Error("Missing deferred COMMIT settlement baseline");
        expect(await physicalSettlementLedger(fixture)).toEqual(await before);
      } finally {
        await blocker.query("rollback");
        if (running !== undefined) await running;
        blocker.release();
        await fixture.owner.persistence.query("alter table fx_system_framework_migration_step_receipt drop constraint retained_physical_commit_wait");
        await fixture.owner.persistence.query(`drop table ${probe}`);
      }
      await fixture.install();
      const completed = await physicalLedger(fixture);
      expect(completed.receipts).toHaveLength(fixture.requiredStepCount);
      expect(completed.publications).toEqual([{ installation: 1, readiness: 1, history: 1, head: 1 }]);
      if (predecessor === undefined) throw new Error("Missing deferred COMMIT predecessor");
      await expect(predecessor.query("commit")).rejects.toBeDefined();
      expect(await physicalLedger(fixture)).toEqual(completed);
    });
  }, 180_000);
});
