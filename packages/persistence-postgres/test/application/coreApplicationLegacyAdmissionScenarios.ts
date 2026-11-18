import { readFile } from "node:fs/promises";
import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createFlarexExecutor } from "../../../executor/src/index";
import type { FlarexExecutorPersistence } from "../../../executor/src/invocation/types";
import { insertDeploymentMetadata, type FlarexMetadataDatabase } from "../../src/application/deployments";
import { insertDeploymentPackageMetadata } from "../../src/application/deploymentPackages";
import { insertDocumentRevision, getDocumentRevisionAtTs } from "../../src/storage/documents/documents";
import { getInvokeSessionMetadata, insertInvokeSessionMetadata } from "../../src/legacy/invokeSessions";
import type { CoreSqlConnection } from "../../src/database/corePersistence/driver";
import type { CoreApplicationLegacyAdmissionReader } from "../../src/application/coreApplicationLegacyAdmission";

export interface LegacyAdmissionFixture {
  readonly metadata: FlarexMetadataDatabase;
  readonly persistence: FlarexExecutorPersistence;
  readonly query: CoreSqlConnection["query"];
  readonly admit: ReturnType<typeof import("../../src/application/coreApplicationLegacyAdmission").makeCoreApplicationLegacyAdmission>;
  readonly reader: CoreApplicationLegacyAdmissionReader;
  readonly namespace: string;
  readonly coreNamespace: string;
  readonly close: () => Promise<void>;
}

/** Use actual retained owner DDL and writers; no migration/admission logic is reproduced. */
export async function installLegacyAdmissionFixture(fixture: LegacyAdmissionFixture) {
  for (const [migration, tables] of [["0000_dapper_warbird.sql", ["deployments", "documents"]],
    ["0001_first_loki.sql", ["deployment_packages"]], ["0002_fuzzy_lenny_balinger.sql", ["invoke_sessions"]]] as const) {
    const text = await readFile(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
    for (const table of tables) {
      const ddl = text.split("--> statement-breakpoint").find(statement => statement.trimStart().startsWith(`CREATE TABLE "${table}"`));
      if (ddl === undefined) throw new Error(`Missing authoritative ${table} DDL`);
      await Effect.runPromise(fixture.query(ddl));
    }
  }
  await Effect.runPromise(fixture.query(await readFile(new URL("../../drizzle/0015_silent_hercules.sql", import.meta.url), "utf8")));
}

const request = { deploymentId: "existing", projectId: "project", path: "items:get", kind: "query" as const,
  args: { id: "1:existing" }, partitionKey: "1:existing" };

export function registerCoreApplicationLegacyAdmissionScenarios(label: string, create: () => Promise<LegacyAdmissionFixture>) {
  describe(label, () => {
    it("admits catalog-proven absence, then rejects existing identity, data and session beside an empty Core target", async () => {
      const fixture = await create();
      try {
        await expect(Effect.runPromise(fixture.admit("existing"))).resolves.toBeUndefined();
        await installLegacyAdmissionFixture(fixture);
        await expect(Effect.runPromise(fixture.admit("existing"))).resolves.toBeUndefined();
        await insertDeploymentMetadata(fixture.metadata, { deploymentId: "existing", projectId: "project" });
        expect(await Effect.runPromise(Effect.result(fixture.admit("existing"))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "legacyDeploymentExists" } });
        await insertDocumentRevision(fixture.metadata, { deploymentId: "existing", id: "1:old", ts: 1, value: { retained: true } });
        await insertInvokeSessionMetadata(fixture.metadata, { deploymentId: "existing", projectId: "project", sessionId: "old-session",
          packageId: "old-package", functionPath: "items:get", functionKind: "query", partitionKey: "1:old", scopeJson: {},
          argsJson: {}, beginTs: 1, schemaVersion: 1, executionModule: "old.js" });
        expect(await Effect.runPromise(Effect.result(fixture.admit("existing"))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "legacyDeploymentExists" } });
        expect(await getDocumentRevisionAtTs(fixture.metadata, "existing", "1:old", 1)).toMatchObject({ value: { retained: true } });
        expect(await getInvokeSessionMetadata(fixture.metadata, "existing", "old-session")).toMatchObject({ state: "active" });
        expect(await Effect.runPromise(fixture.query(`SELECT count(*)::int AS count FROM "${fixture.coreNamespace}".documents`)))
          .toEqual([{ count: 0 }]);
      } finally { await fixture.close(); }
    }, 60_000);

    it("refuses orphan durable data/session and a partial or unreadable legacy catalog", async () => {
      const fixture = await create();
      try {
        await installLegacyAdmissionFixture(fixture);
        await insertDocumentRevision(fixture.metadata, { deploymentId: "orphan-data", id: "1:old", ts: 1, value: {} });
        await insertInvokeSessionMetadata(fixture.metadata, { deploymentId: "orphan-session", projectId: "project", sessionId: "old-session",
          packageId: "old-package", functionPath: "items:get", functionKind: "query", partitionKey: "1:old", scopeJson: {},
          argsJson: {}, beginTs: 1, schemaVersion: 1, executionModule: "old.js" });
        for (const id of ["orphan-data", "orphan-session"]) expect(await Effect.runPromise(Effect.result(fixture.admit(id))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "legacyDeploymentExists" } });
        await Effect.runPromise(fixture.query("ALTER TABLE deployments RENAME COLUMN project_id TO broken_project_id"));
        expect(await Effect.runPromise(Effect.result(fixture.admit("new"))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "metadataReadFailed" } });
        await Effect.runPromise(fixture.query("DROP TABLE deployments"));
        expect(await Effect.runPromise(Effect.result(fixture.admit("new"))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidLegacyCatalog" } });
      } finally { await fixture.close(); }
    }, 60_000);

    it("rejects the committed deployment behind an in-flight legacy start before its session is inserted", async () => {
      const fixture = await create();
      const observed = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
      let starting: ReturnType<ReturnType<typeof createFlarexExecutor>["beginInvokeSession"]> | undefined;
      try {
        await installLegacyAdmissionFixture(fixture);
        const executor = createFlarexExecutor({ persistence: fixture.persistence });
        await expect(executor.beginInvokeSession(request)).rejects.toMatchObject({ name: "DeploymentNotFoundError" });
        await expect(Effect.runPromise(fixture.admit("existing"))).resolves.toBeUndefined();
        await insertDeploymentMetadata(fixture.metadata, { deploymentId: "existing", projectId: "project", activePackageId: "old-package" });
        await insertDeploymentPackageMetadata(fixture.metadata, { deploymentId: "existing", packageId: "old-package", sourcePackageHash: "a".repeat(64),
          executionModule: "old.js", sourcePackageJson: {}, analysisJson: {
            schema: { version: 1, tables: [{ tableId: 1, name: "items", placement: { kind: "partitionBy", field: "_id" } }], indexes: [] },
            functions: { functions: [{ path: "items:get", kind: "query", partition: { type: "partition", table: "items", selector: "byId",
              partitionField: "_id", argField: "id" } }] },
          } });
        const paused = createFlarexExecutor({ persistence: { ...fixture.persistence, getDeploymentMetadata: async id => {
          const metadata = await fixture.persistence.getDeploymentMetadata(id);
          await Effect.runPromise(Deferred.succeed(observed, undefined));
          await Effect.runPromise(Deferred.await(release));
          return metadata;
        } } });
        starting = paused.beginInvokeSession(request);
        await Effect.runPromise(Deferred.await(observed));
        expect(await Effect.runPromise(fixture.query("SELECT count(*)::int AS count FROM invoke_sessions"))).toEqual([{ count: 0 }]);
        expect(await Effect.runPromise(Effect.result(fixture.admit("existing"))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "legacyDeploymentExists" } });
        await Effect.runPromise(Deferred.succeed(release, undefined));
        const session = await starting;
        expect(await getInvokeSessionMetadata(fixture.metadata, "existing", session.sessionId)).toMatchObject({ state: "active" });
      } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await starting; await fixture.close(); }
    }, 60_000);
  });
}
