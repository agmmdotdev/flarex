import { webcrypto } from "node:crypto";
import { sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { beforeAll, onTestFinished, describe, expect, it } from "vitest";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import {
  isRetryableApplicationMutationAdmissionCause,
} from "../../../src/application/applicationMutationAdmission";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { runEffect } from "../../support/effectTestRuntime";
import { RUNTIME_HOST_IDENTITY, COMPATIBILITY_DATE } from "../support/readinessArtifacts";
import { readinessFixture } from "../support/readinessFixture";
import { prepareReadinessAuthorities } from "../support/readinessPreparation";
import { scalarCount } from "../support/readinessEvidence";

beforeAll(async () => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  await migratedPGliteDataDir();
}, 120_000);

describe("Application readiness/settlement", { timeout: 30_000 }, () => {
  it("keeps ordered selected-row refusal and classifies joined PGlite SQL failures", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    onTestFinished(() => db.close());
    let faultCode: "42P01" | "40001" | null = null;
    let injected = 0;
    const targetPersistence = await createPGlitePersistence({
      db: {
        exec: db.exec.bind(db),
        query: db.query.bind(db),
        transaction: run => db.transaction(tx => run({
          exec: tx.exec.bind(tx),
          query: new Proxy(tx.query, {
            apply(targetQuery, _receiver, args: unknown[]) {
              const sql = args[0];
              if (faultCode !== null && typeof sql === "string" &&
                sql.includes("fx_system_application_candidate_v1") &&
                sql.includes("fx_system_application_analysis_v1") &&
                sql.includes("fx_system_application_publication_v1")) {
                injected++;
                return Promise.reject(Object.assign(
                  new Error("Injected selected-row read failure"),
                  { code: faultCode },
                ));
              }
              return Reflect.apply(targetQuery, tx, args);
            },
          }),
        })),
      },
    });
    const fixture = await readinessFixture({ targetPersistence });
    const result = await runEffect(Effect.result(fixture.repository.readReady({
      deploymentId: "",
      scopeId: fixture.input.scopeId,
      revisionId: fixture.input.revisionId,
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationReadinessError",
        operation: "readReady",
        reason: "invalidInput",
      });
    }
    await fixture.target.query(
      "update fx_system_application_analysis_v1 set manifest_bytes = decode('00', 'hex') where scope_id = $1",
      [fixture.authority.scopeId],
    );
    await fixture.target.query(
      "update fx_system_application_candidate_v1 set storage_generation_fence = storage_generation_fence + 1 where scope_id = $1",
      [fixture.authority.scopeId],
    );
    const readFailure = () => runEffect(Effect.result(
      fixture.repository.readReady(fixture.input),
    ));
    const domain = await readFailure();
    expect(Result.isFailure(domain)).toBe(true);
    if (Result.isFailure(domain)) {
      expect(domain.failure).toMatchObject({ reason: "authorityChanged" });
    }
    for (const [code, retryable] of [
      ["42P01", false],
      ["40001", true],
    ] as const) {
      faultCode = code;
      const result = await readFailure();
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({ reason: "resourceFailure", retryable });
      }
    }
    expect(injected).toBe(2);
    faultCode = null;
    const afterFault = await readFailure();
    expect(Result.isFailure(afterFault)).toBe(true);
    if (Result.isFailure(afterFault)) {
      expect(afterFault.failure).toMatchObject({ reason: "authorityChanged" });
    }
  })

  it("classifies only transient PostgreSQL admission failures as retryable", () => {
    expect(isRetryableApplicationMutationAdmissionCause({ code: "40001" }))
      .toBe(true);
    expect(isRetryableApplicationMutationAdmissionCause({ code: "42P01" }))
      .toBe(false);
  })

  it("fails before schema publication when the explicit task catalog is absent", async () => {
    const fixture = await readinessFixture({ registerTaskCatalog: false });

    const result = await runEffect(fixture.repository.settle(fixture.input));

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "taskCatalogMissing",
      revisionId: fixture.input.revisionId,
    });
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  })

  it("rejects a schema publisher bound to another control database", async () => {
    const fixture = await readinessFixture({ foreignSchemaControl: true });

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidComposition" });
    }
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  })

  it("rolls back schema authority when atomic publication fails", async () => {
    const fixture = await readinessFixture({ failSchemaPublication: true });

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));
    const authorities = await fixture.control.query<{ status: string }>(
      `select status from fx_control_application_schema_authority_v1`,
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(authorities.rows).toEqual([]);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  })

  it("settles and exactly replays across split control and target stores", async () => {
    const fixture = await readinessFixture();
    const schemaVersionId = await prepareReadinessAuthorities(fixture);

    const first = await runEffect(fixture.repository.settle(fixture.input));
    const replay = await runEffect(fixture.repository.settle(fixture.input));

    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      scopeId: fixture.authority.scopeId,
      revisionId: fixture.input.revisionId,
      schemaVersionId,
    });
    expect(replay).toMatchObject({
      ...first,
      disposition: "replayed",
    });
    expect(fixture.materializationCount()).toBe(1);
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_revision_schema_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_function_v1",
    )).toBe(1);
  })

  it("converges concurrent identical settlement on one readiness receipt", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);

    const results = await Promise.all([
      runEffect(fixture.repository.settle(fixture.input)),
      runEffect(fixture.repository.settle(fixture.input)),
    ]);

    expect(results.map(result =>
      result.status === "ready" ? result.disposition : result.status
    ).sort()).toEqual(["inserted", "replayed"]);
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_function_v1",
    )).toBe(1);
  })

  it("rejects invalid cold evidence without committing readiness", async () => {
    const fixture = await readinessFixture({ coldMode: "wrongTarget" });
    await prepareReadinessAuthorities(fixture);

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "coldMaterialization" });
    }
    expect(fixture.materializationCount()).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_revision_schema_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  })

  it("fails closed on stored cold-receipt corruption without rematerializing", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    await runEffect(fixture.repository.settle(fixture.input));
    await fixture.target.query(
      `update fx_system_application_readiness_function_v1
          set cold_receipt_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array([1]), fixture.authority.scopeId, fixture.input.revisionId],
    );

    const replay = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) {
      expect(replay.failure).toMatchObject({ reason: "conflictingReplay" });
    }
    expect(fixture.materializationCount()).toBe(1);
  })

  it("rejects a non-empty task catalog with a missing stored definition", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await fixture.target.query(
      `delete from fx_system_application_task_definition_v1
        where scope_id = $1 and revision_id = $2`,
      [fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationTaskCatalogSnapshotError",
        reason: "storedState",
      });
    }
    expect(fixture.materializationCount()).toBe(0);
  })

  it("rejects corrupted task-catalog binding evidence", async () => {
    const fixture = await readinessFixture();
    await fixture.target.query(
      `update fx_system_application_task_catalog_v1
          set binding_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array([1]), fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationTaskCatalogSnapshotError",
        reason: "storedState",
      });
    }
    expect(fixture.materializationCount()).toBe(0);
  })

  it("commits runtime policy for an explicit zero-function revision", async () => {
    const fixture = await readinessFixture({ includeFunction: false });
    await prepareReadinessAuthorities(fixture);

    const result = await runEffect(fixture.repository.settle(fixture.input));
    const stored = await fixture.target.query<{
      runtime_host_identity: string;
      compatibility_date: string;
    }>(
      `select runtime_host_identity, compatibility_date
         from fx_system_application_readiness_v1`,
    );

    expect(result).toMatchObject({ status: "ready", disposition: "inserted" });
    expect(fixture.materializationCount()).toBe(0);
    expect(stored.rows).toEqual([{
      runtime_host_identity: RUNTIME_HOST_IDENTITY,
      compatibility_date: COMPATIBILITY_DATE,
    }]);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_function_v1",
    )).toBe(0);
  })
});
