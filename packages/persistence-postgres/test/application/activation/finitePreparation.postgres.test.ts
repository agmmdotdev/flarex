import { webcrypto } from "node:crypto";
import type { PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  prepareFiniteActiveApplication,
} from "../../../src/application/activation/repositoryIdentity";
import {
  createApplicationTaskCatalogSnapshotPort,
} from "../../../src/application/tasks/applicationTaskBindings";
import {
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
} from "../../../src/database/schema";
import { runEffect } from "../../support/effectTestRuntime";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../support/postgresHelpers";
import {
  readinessFixture,
  prepareReadinessAuthorities,
  enablePhysicalBuilds,
} from "../support/readinessPostgresFixture";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("Application activation/finitePreparation.postgres", { timeout: 30_000 }, () => {
  it("refuses aggregate finite function bodies before the ordinary PostgreSQL driver transfers them", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
      await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
      const publication = (await target.drizzle.select().from(fxSystemApplicationPublicationsV1))[0];
      if (publication === undefined) throw new Error("Expected publication");
      await target.drizzle.insert(fxSystemApplicationFunctionsV1).values(Array.from({ length: 17 }, (_, index) => ({
        scopeId: publication.scopeId, revisionId: publication.revisionId,
        functionCatalogSha256: publication.functionCatalogSha256,
        moduleName: "users", functionPath: `users:peer${index}`, exportName: `peer${index}`,
        functionKind: "query", visibility: "public",
        entrySha256: new Uint8Array(32).fill(index + 1), entryBytes: new Uint8Array(65_536),
      } satisfies typeof fxSystemApplicationFunctionsV1.$inferInsert)));
      const catalog = (await target.drizzle.select().from(fxSystemApplicationTaskCatalogsV1))[0];
      if (catalog === undefined) throw new Error("Expected task catalog");
      await target.drizzle.update(fxSystemApplicationTaskCatalogsV1).set({ taskCount: 1 });
      await target.drizzle.insert(fxSystemApplicationTaskDefinitionsV1).values({ scopeId: catalog.scopeId,
        revisionId: catalog.revisionId, taskCatalogBindingSha256: catalog.taskCatalogBindingSha256,
        taskDefinitionBindingSha256: new Uint8Array(32).fill(1), canonicalTaskManifestSha256: new Uint8Array(32).fill(1),
        taskId: "tasks.orders.process", logicalModulePath: "tasks/orders", sourceModulePath: "tasks/orders.js", exportName: "run",
        bindingBytes: sql<Uint8Array>`decode(repeat('00', 16777216), 'hex')`,
        manifestBytes: sql<Uint8Array>`decode(repeat('00', 16777216), 'hex')`,
      });
      let largestDriverBytes = 0;
      const observe = (value: unknown): void => {
        if (value instanceof Uint8Array) largestDriverBytes = Math.max(largestDriverBytes, value.byteLength);
        else if (Array.isArray(value)) value.forEach(observe);
        else if (typeof value === "object" && value !== null) Object.values(value).forEach(observe);
      };
      const patched = new Map<PoolClient, PoolClient["query"]>();
      const onAcquire = (client: PoolClient) => {
        const originalQuery = client.query;
        client.query = new Proxy(originalQuery, { apply(query, receiver, args: unknown[]) {
          return Promise.resolve(Reflect.apply(query, receiver, args)).then(result => { observe(result); return result; });
        } });
        patched.set(client, originalQuery);
      };
      const onRelease = (_error: Error | undefined, client: PoolClient) => {
        const originalQuery = patched.get(client);
        if (originalQuery !== undefined) client.query = originalQuery;
        patched.delete(client);
      };
      target.pool.on("acquire", onAcquire);
      target.pool.on("release", onRelease);
      try {
        await expect(runEffect(prepareFiniteActiveApplication(activation)))
          .rejects.toMatchObject({ reason: "storedState" });
        expect(largestDriverBytes).toBeGreaterThan(0);
        expect(largestDriverBytes).toBeLessThan(16_384);
        largestDriverBytes = 0;
        const taskPort = createApplicationTaskCatalogSnapshotPort();
        await expect(target.drizzle.transaction(tx => runEffect(taskPort.loadInTransaction(tx,
          fixture.authority, fixture.input.revisionId)))).rejects.toMatchObject({ reason: "storedState" });
        expect(largestDriverBytes).toBeGreaterThan(0);
        expect(largestDriverBytes).toBeLessThan(16_384);
      } finally {
        target.pool.off("acquire", onAcquire);
        target.pool.off("release", onRelease);
        for (const [client, query] of patched) client.query = query;
      }
    });
  }, 120_000)
});
