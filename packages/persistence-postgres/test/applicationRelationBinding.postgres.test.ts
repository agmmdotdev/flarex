import { webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  publishApplicationRelationBindingEffect,
  type ApplicationRelationBindingRepository,
  type PublishApplicationRelationBindingInput,
} from "../src/applicationRelationBinding";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";
import { relationManifestV2 } from
  "./applicationAnalysisRegistrationTestSupport";
import {
  acquirePostgresDeploymentLock,
  postgresUrl,
  useFileScopedPostgresPersistence,
  waitForBlockedPostgresDeploymentLocks,
  type HeldPostgresDeploymentLock,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgres = useFileScopedPostgresPersistence();

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describePostgres("Application relation binding - PostgreSQL", () => {
  it("converges concurrent identical publications through one stable binding", async () => {
    await withPostgres(async persistence => {
      const deploymentId = "deployment_relation_binding_postgres";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_${deploymentId}`,
      });
      const input = await publicationInput(deploymentId);
      const repository = repositoryFor(persistence);
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const publications = [
        runEffect(publishApplicationRelationBindingEffect(repository, input)),
        runEffect(publishApplicationRelationBindingEffect(repository, input)),
      ] as const;

      await releaseAfterBlocked(lock, persistence, publications);
      const [first, second] = await Promise.all(publications);

      expect([first.status, second.status].toSorted()).toEqual([
        "created",
        "existing",
      ]);
      expect(first.binding).toEqual(second.binding);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        relation_count: "1",
        edge_count: "1",
        root_count: "1",
        pin_count: "1",
      });
    });
  }, 120_000);

  it("rolls back every catalog projection when the transaction fails", async () => {
    await withPostgres(async persistence => {
      const deploymentId = "deployment_relation_binding_postgres_rollback";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_${deploymentId}`,
      });
      const rollback = new Error("rollback after relation publication");
      const repository: ApplicationRelationBindingRepository = {
        db: persistence.drizzle,
        runTransaction: <Value>(
          run: (tx: StableTableCatalogTransaction) => Promise<Value>,
        ): Promise<Value> => persistence.drizzle.transaction(async tx => {
          await run(tx);
          throw rollback;
        }),
      };
      const result = await runEffect(Effect.result(
        publishApplicationRelationBindingEffect(
          repository,
          await publicationInput(deploymentId),
        ),
      ));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          reason: "resourceFailure",
          retryable: false,
          cause: rollback,
        });
      }
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        relation_count: "0",
        edge_count: "0",
        root_count: "0",
        pin_count: "0",
      });
    });
  }, 120_000);

  it("round-trips canonical negative zero through PostgreSQL JSONB", async () => {
    await withPostgres(async persistence => {
      const deploymentId = "deployment_relation_binding_postgres_negative_zero";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_${deploymentId}`,
      });
      const input = await publicationInput(deploymentId, {
        many: true,
        minItems: -0,
      });
      const repository = repositoryFor(persistence);

      const created = await runEffect(publishApplicationRelationBindingEffect(
        repository,
        input,
      ));
      const replay = await runEffect(publishApplicationRelationBindingEffect(
        repository,
        input,
      ));

      expect(created.status).toBe("created");
      expect(replay.status).toBe("existing");
      expect(replay.boundPublicationSha256).toBe(
        created.boundPublicationSha256,
      );
    });
  }, 120_000);

  it("rejects missing and self-referential preserved origins in PostgreSQL", async () => {
    await withPostgres(async persistence => {
      const deploymentId = "deployment_relation_binding_postgres_origin_check";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_${deploymentId}`,
      });
      await runEffect(publishApplicationRelationBindingEffect(
        repositoryFor(persistence),
        await publicationInput(deploymentId),
      ));

      await expect(persistence.query(`
        update fx_control_schema_relation_binding
        set evolution_kind = 'preserve',
            origin_schema_version_id = null,
            origin_relation_ordinal = null,
            physical_evolution = 'reuse'
        where deployment_id = $1
      `, [deploymentId])).rejects.toThrow();
      await expect(persistence.query(`
        update fx_control_schema_relation_binding
        set evolution_kind = 'preserve',
            origin_schema_version_id = schema_version_id,
            origin_relation_ordinal = relation_ordinal,
            physical_evolution = 'reuse'
        where deployment_id = $1
      `, [deploymentId])).rejects.toThrow();
    });
  }, 120_000);
});

interface RelationManifestOptions {
  readonly many?: boolean;
  readonly minItems?: number;
}

function repositoryFor(
  persistence: PostgresFlarexPersistence,
): ApplicationRelationBindingRepository {
  return {
    db: persistence.drizzle,
    runTransaction: run => persistence.drizzle.transaction(run),
  };
}

async function publicationInput(
  deploymentId: string,
  options: RelationManifestOptions = {},
): Promise<PublishApplicationRelationBindingInput> {
  const canonical = Result.getOrThrow(
    canonicalizeApplicationManifestV2(
      relationManifestV2("a".repeat(64), options),
    ),
  );
  const manifestSha256 = encodeBytesToLowercaseHex(new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(canonical.canonicalBytes),
    ),
  ));
  return Object.freeze({
    deploymentId,
    manifest: canonical.manifest,
    manifestSha256,
    decisions: Object.freeze([Object.freeze({
      relationOrdinal: 1,
      evolution: Object.freeze({ kind: "new" as const }),
    })]),
  });
}

async function releaseAfterBlocked(
  lock: HeldPostgresDeploymentLock,
  persistence: PostgresFlarexPersistence,
  publications: ReadonlyArray<Promise<unknown>>,
): Promise<void> {
  let released = false;
  let setupError: unknown;
  try {
    await waitForBlockedPostgresDeploymentLocks(
      persistence,
      lock,
      publications.length,
    );
    await lock.client.query("commit");
    released = true;
  } catch (error: unknown) {
    setupError = error;
  } finally {
    if (!released) {
      await lock.client.query("rollback").catch(() => undefined);
    }
    lock.client.release();
  }
  if (setupError !== undefined) {
    await Promise.allSettled(publications);
    throw setupError;
  }
}

async function catalogCounts(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<Readonly<{
  relation_count: string;
  edge_count: string;
  root_count: string;
  pin_count: string;
}>> {
  const counts = await persistence.query<{
    relation_count: string;
    edge_count: string;
    root_count: string;
    pin_count: string;
  }>(`
    select
      (select count(*)::text from fx_control_relation
        where deployment_id = $1) as relation_count,
      (select count(*)::text from fx_control_edge_definition
        where deployment_id = $1) as edge_count,
      (select count(*)::text from fx_control_bound_application_schema
        where deployment_id = $1) as root_count,
      (select count(*)::text
         from fx_control_application_manifest_schema_binding
        where deployment_id = $1) as pin_count
  `, [deploymentId]);
  const count = counts.rows[0];
  if (count === undefined) {
    throw new Error("Postgres relation-binding count query returned no row.");
  }
  return count;
}
