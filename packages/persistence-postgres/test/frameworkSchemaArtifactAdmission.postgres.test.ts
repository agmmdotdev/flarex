import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { admitFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/admission";
import { captureFrameworkSchemaArtifact } from
  "../src/frameworkSchema/artifact/canonical";
import { makeFrameworkSchemaArtifactControlSessionStarter } from
  "../src/frameworkSchema/artifact/controlSession";
import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactCaptureInput,
} from "../src/frameworkSchema/artifact/model";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from
  "../src/frameworkSchema/artifact/postgresControlSession";
import {
  makeFrameworkSchemaArtifactRepository,
  prepareFrameworkSchemaArtifactAdmission,
  type FrameworkSchemaArtifactRepository,
} from "../src/frameworkSchema/artifact/repository";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";
import {
  acquirePostgresDeploymentLock,
  type HeldPostgresDeploymentLock,
  postgresUrl,
  rollbackAndReleasePostgresClient,
  waitForBlockedPostgresDeploymentLocks,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const CONCURRENT_ADMISSIONS = 8;

describePostgres(
  "private framework schema artifact admission - PostgreSQL",
  () => {
    it("converges concurrent exact admissions to one parent and one edge set", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const dependencies = await Promise.all([
          captureArtifact({
            lineageId: "catalog-taxonomy",
            payload: { modules: ["category"] },
          }),
          captureArtifact({
            lineageId: "catalog-inventory",
            payload: { modules: ["inventory"] },
          }),
        ]);
        for (const dependency of dependencies) {
          expect((await admitArtifact(repository, dependency)).status)
            .toBe("created");
        }
        const parent = await captureArtifact({
          lineageId: "catalog-product",
          dependencies: dependencies.map(dependency => dependency.identity),
          payload: { modules: ["product"] },
        });

        const results = await Promise.all(
          Array.from(
            { length: CONCURRENT_ADMISSIONS },
            () => admitArtifact(repository, parent),
          ),
        );

        expect(results.filter(result => result.status === "created"))
          .toHaveLength(1);
        expect(results.filter(result => result.status === "existing"))
          .toHaveLength(CONCURRENT_ADMISSIONS - 1);
        expect(results.every(result =>
          result.artifact.identity.artifactSha256 ===
            parent.identity.artifactSha256 &&
          result.artifact.canonicalJson === parent.canonicalJson
        )).toBe(true);

        expect(await countArtifactRows(persistence, parent)).toBe(1);

        const edges = await persistence.query<{
          dependencyOrdinal: number;
          lineageId: string;
          artifactSha256: string;
        }>(`
          select edge.dependency_ordinal as "dependencyOrdinal",
                 dependency.lineage_id as "lineageId",
                 encode(dependency.artifact_sha256, 'hex') as "artifactSha256"
          from ${DEPENDENCY_TABLE} as edge
          join ${ARTIFACT_TABLE} as parent
            on parent.artifact_storage_id = edge.artifact_storage_id
          join ${ARTIFACT_TABLE} as dependency
            on dependency.artifact_storage_id = edge.dependency_storage_id
          where parent.deployment_id = $1
            and parent.owner = $2
            and parent.lineage_id = $3
            and parent.artifact_sha256 = decode($4, 'hex')
          order by edge.dependency_ordinal
        `, [
          parent.identity.deploymentId,
          parent.identity.owner,
          parent.identity.lineageId,
          parent.identity.artifactSha256,
        ]);
        expect(edges.rows).toEqual(parent.dependencies.map(
          (dependency, dependencyOrdinal) => ({
            dependencyOrdinal,
            lineageId: dependency.lineageId,
            artifactSha256: dependency.artifactSha256,
          }),
        ));
      });
    }, 180_000);

    it("proves contenders wait on the deployment row and observe the winner", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const artifact = await captureArtifact();
        const lock = await acquirePostgresDeploymentLock(
          persistence,
          artifact.identity.deploymentId,
        );
        const admissions = [
          admitArtifact(repository, artifact),
          admitArtifact(repository, artifact),
        ] as const;
        const admissionResults = Promise.all(admissions);
        void admissionResults.catch(() => undefined);

        await releaseAfterBlocked(lock, persistence, 2, admissions);
        const results = await admissionResults;

        expect(results.map(result => result.status).sort()).toEqual([
          "created",
          "existing",
        ]);
        expect(await countArtifactRows(persistence, artifact)).toBe(1);
      });
    }, 180_000);
  },
);

function makePostgresArtifactRepository(
  persistence: PostgresFlarexPersistence,
): FrameworkSchemaArtifactRepository {
  const controlDb = persistence.drizzle;
  return Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(
        persistence.pool,
      ),
    }),
    readTimeoutMilliseconds: 10_000,
    attemptTimeoutMilliseconds: 30_000,
    recoveryTimeoutMilliseconds: 30_000,
    lockTimeoutMilliseconds: 10_000,
  }));
}

async function captureArtifact(
  overrides: Partial<FrameworkSchemaArtifactCaptureInput> = {},
): Promise<FrameworkSchemaArtifact> {
  return runEffect(captureFrameworkSchemaArtifact({
    deploymentId: "deployment-framework-admission-pg",
    owner: "medusa",
    lineageId: "catalog-main",
    payloadCodec: { format: "medusa-dml", version: 1 },
    provenance: { source: "module-loader" },
    capabilities: ["framework.medusa.catalog"],
    dependencies: [],
    payload: { modules: ["catalog"] },
    ...overrides,
  }));
}

async function admitArtifact(
  repository: FrameworkSchemaArtifactRepository,
  artifact: FrameworkSchemaArtifact,
) {
  return runEffect(admitFrameworkSchemaArtifactEffect(
    repository,
    Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact)),
  ));
}

async function insertDeployment(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values ('deployment-framework-admission-pg',
            'project-framework-admission-pg')
  `);
}

async function expectPostgres18OrdinaryRole(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const result = await persistence.query<{
    serverVersion: string;
    isSuperuser: boolean;
    canCreateDatabase: boolean;
    canCreateRole: boolean;
  }>(`
    select current_setting('server_version') as "serverVersion",
           role.rolsuper as "isSuperuser",
           role.rolcreatedb as "canCreateDatabase",
           role.rolcreaterole as "canCreateRole"
    from pg_roles as role
    where role.rolname = current_user
  `);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toEqual({
    serverVersion: expect.stringMatching(/^18\./),
    isSuperuser: false,
    canCreateDatabase: false,
    canCreateRole: false,
  });
}

async function countArtifactRows(
  persistence: PostgresFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(`
    select count(*)::int as count
    from ${ARTIFACT_TABLE}
    where deployment_id = $1
      and owner = $2
      and lineage_id = $3
      and artifact_sha256 = decode($4, 'hex')
  `, [
    artifact.identity.deploymentId,
    artifact.identity.owner,
    artifact.identity.lineageId,
    artifact.identity.artifactSha256,
  ]);
  return result.rows[0]?.count ?? 0;
}

async function releaseAfterBlocked(
  lock: HeldPostgresDeploymentLock,
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
  operations: ReadonlyArray<Promise<unknown>>,
): Promise<void> {
  let released = false;
  let setupError: unknown;
  try {
    await waitForBlockedPostgresDeploymentLocks(
      persistence,
      lock,
      expectedBlocked,
    );
    await lock.client.query("commit");
    released = true;
  } catch (error) {
    setupError = error;
  } finally {
    if (released) {
      lock.client.release();
    } else {
      await rollbackAndReleasePostgresClient(lock.client);
    }
  }
  if (setupError !== undefined) {
    await Promise.allSettled(operations);
    throw setupError;
  }
}
