import { Effect, Result } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { admitFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/admission";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
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
  type PreparedFrameworkSchemaArtifactAdmission,
} from "../src/frameworkSchema/artifact/repository";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";
import {
  acquirePostgresDeploymentLock,
  type BlockedPostgresDeploymentLockWaiter,
  type HeldPostgresDeploymentLock,
  postgresUrl,
  rollbackAndReleasePostgresClient,
  waitForBlockedPostgresDeploymentLockWaiters,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const CONCURRENT_ADMISSIONS = 8;
const DEFAULT_DEPLOYMENT_ID = "deployment-framework-admission-pg";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
        const prepared = prepareAdmissionOrThrow(artifact);
        const admissions: ReturnType<typeof admitPreparedArtifact>[] = [];

        await runWithBlockedDeploymentLock(
          persistence,
          artifact.identity.deploymentId,
          2,
          track => {
            admissions.push(track(admitPreparedArtifact(
              repository,
              prepared,
            )));
            admissions.push(track(admitPreparedArtifact(
              repository,
              prepared,
            )));
          },
        );
        const results = await Promise.all(admissions);

        expect(results.map(result => result.status).sort()).toEqual([
          "created",
          "existing",
        ]);
        expect(await countArtifactRows(persistence, artifact)).toBe(1);
      });
    }, 180_000);

    it("serializes concurrent canonical collisions to one stored winner", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const first = await captureArtifact({
          lineageId: "catalog-collision",
          payload: { modules: ["first"] },
        });
        const firstEvidence = requireCapturedEvidence(first);
        vi.stubGlobal(
          "crypto",
          cryptoReturning(firstEvidence.artifactSha256Bytes),
        );
        const second = await captureArtifact({
          lineageId: "catalog-collision",
          payload: { modules: ["second"] },
        });
        const secondEvidence = requireCapturedEvidence(second);
        expect(second.identity).toEqual(first.identity);
        expect(second.canonicalJson).not.toBe(first.canonicalJson);
        expect(secondEvidence.canonicalBytes).not.toEqual(
          firstEvidence.canonicalBytes,
        );
        const preparedAttempts = [first, second].map(artifact =>
          Object.freeze({
            artifact,
            prepared: prepareAdmissionOrThrow(artifact),
          })
        );
        const attempts: Array<Readonly<{
          artifact: FrameworkSchemaArtifact;
          admission: ReturnType<typeof admitPreparedArtifactResult>;
        }>> = [];

        try {
          await runWithBlockedDeploymentLock(
            persistence,
            first.identity.deploymentId,
            2,
            track => {
              for (const attempt of preparedAttempts) {
                attempts.push(Object.freeze({
                  artifact: attempt.artifact,
                  admission: track(admitPreparedArtifactResult(
                    repository,
                    attempt.prepared,
                  )),
                }));
              }
            },
          );
          const outcomes = await Promise.all(attempts.map(async attempt =>
            Object.freeze({
              artifact: attempt.artifact,
              outcome: await attempt.admission,
            })
          ));
          let winner: FrameworkSchemaArtifact | undefined;
          let collisionCount = 0;
          for (const attempt of outcomes) {
            if (Result.isSuccess(attempt.outcome)) {
              expect(attempt.outcome.success.status).toBe("created");
              expect(attempt.outcome.success.artifact).toBe(attempt.artifact);
              expect(winner).toBeUndefined();
              winner = attempt.artifact;
            } else {
              collisionCount += 1;
              expect(attempt.outcome.failure).toMatchObject({
                operation: "admit",
                reason: "digestCollision",
                message: "Framework schema artifact digest collision",
                retryable: false,
                identity: first.identity,
              });
              expect(attempt.outcome.failure.identity).not.toBe(first.identity);
              expect(Object.hasOwn(attempt.outcome.failure, "cause")).toBe(
                false,
              );
            }
          }
          expect(collisionCount).toBe(1);
          if (winner === undefined) {
            throw new Error("Expected one collision winner.");
          }
          const winnerEvidence = requireCapturedEvidence(winner);
          const loser = winner === first ? second : first;
          const loserEvidence = requireCapturedEvidence(loser);
          const stored = await persistence.query<{
            canonicalByteLength: number;
            canonicalBytesHex: string;
            admittedAtFinite: boolean;
          }>(`
            select canonical_byte_length as "canonicalByteLength",
                   encode(canonical_bytes, 'hex') as "canonicalBytesHex",
                   isfinite(admitted_at) as "admittedAtFinite"
            from ${ARTIFACT_TABLE}
            where deployment_id = $1
              and owner = $2
              and lineage_id = $3
              and artifact_sha256 = decode($4, 'hex')
          `, [
            winner.identity.deploymentId,
            winner.identity.owner,
            winner.identity.lineageId,
            winner.identity.artifactSha256,
          ]);
          expect(stored.rows).toEqual([{
            canonicalByteLength: winnerEvidence.canonicalBytes.byteLength,
            canonicalBytesHex: Buffer.from(
              winnerEvidence.canonicalBytes,
            ).toString("hex"),
            admittedAtFinite: true,
          }]);
          expect(stored.rows[0]?.canonicalBytesHex).not.toBe(
            Buffer.from(loserEvidence.canonicalBytes).toString("hex"),
          );
          expect(await countArtifactRows(persistence, winner)).toBe(1);
          expect(await countDependencyRows(persistence, winner)).toBe(0);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    }, 180_000);

    it("isolates owner and lineage coordinates under deployment contention", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const medusaSharedLineage = await captureArtifact({
          lineageId: "catalog-shared-coordinate",
          payload: { modules: ["medusa-shared"] },
        });
        const sharedDigestEvidence = requireCapturedEvidence(
          medusaSharedLineage,
        );
        vi.stubGlobal(
          "crypto",
          cryptoReturning(sharedDigestEvidence.artifactSha256Bytes),
        );
        const payloadSharedLineage = await captureArtifact({
          owner: "payload",
          lineageId: "catalog-shared-coordinate",
          payloadCodec: { format: "payload-config", version: 1 },
          provenance: { source: "payload-config-loader" },
          capabilities: ["framework.payload.catalog"],
          payload: { collections: ["catalog"] },
        });
        const medusaOtherLineage = await captureArtifact({
          lineageId: "catalog-other-coordinate",
          payload: { modules: ["medusa-other"] },
        });
        const coordinateArtifacts = [
          medusaSharedLineage,
          payloadSharedLineage,
          medusaOtherLineage,
        ] as const;
        expect(coordinateArtifacts.map(artifact =>
          artifact.identity.artifactSha256
        )).toEqual([
          medusaSharedLineage.identity.artifactSha256,
          medusaSharedLineage.identity.artifactSha256,
          medusaSharedLineage.identity.artifactSha256,
        ]);
        expect(new Set(coordinateArtifacts.map(artifact =>
          artifact.canonicalJson
        )).size).toBe(3);
        const attempts = [
          medusaSharedLineage,
          payloadSharedLineage,
          medusaOtherLineage,
          medusaSharedLineage,
        ].map(artifact => Object.freeze({
          artifact,
          prepared: prepareAdmissionOrThrow(artifact),
        }));
        const admissions: Array<Readonly<{
          artifact: FrameworkSchemaArtifact;
          admission: ReturnType<typeof admitPreparedArtifact>;
        }>> = [];

        try {
          await runWithBlockedDeploymentLock(
            persistence,
            medusaSharedLineage.identity.deploymentId,
            attempts.length,
            track => {
              for (const attempt of attempts) {
                admissions.push(Object.freeze({
                  artifact: attempt.artifact,
                  admission: track(admitPreparedArtifact(
                    repository,
                    attempt.prepared,
                  )),
                }));
              }
            },
            (_lock, waiters) => {
              expect(waiters).toHaveLength(attempts.length);
              return Promise.resolve();
            },
          );
          const outcomes = await Promise.all(admissions.map(
            async attempt => Object.freeze({
              artifact: attempt.artifact,
              result: await attempt.admission,
            }),
          ));
          expect(outcomes.filter(outcome =>
            outcome.result.status === "created"
          )).toHaveLength(3);
          expect(outcomes.filter(outcome =>
            outcome.result.status === "existing"
          )).toHaveLength(1);
          expect(outcomes.filter(outcome =>
            outcome.artifact === medusaSharedLineage
          ).map(outcome => outcome.result.status).sort()).toEqual([
            "created",
            "existing",
          ]);
          for (const distinctArtifact of [
            payloadSharedLineage,
            medusaOtherLineage,
          ]) {
            expect(outcomes.find(outcome =>
              outcome.artifact === distinctArtifact
            )?.result.status).toBe("created");
          }

          const stored = await persistence.query<{
            owner: string;
            lineageId: string;
            artifactSha256: string;
            canonicalBytesHex: string;
          }>(`
            select owner,
                   lineage_id as "lineageId",
                   encode(artifact_sha256, 'hex') as "artifactSha256",
                   encode(canonical_bytes, 'hex') as "canonicalBytesHex"
            from ${ARTIFACT_TABLE}
            where deployment_id = $1
              and artifact_sha256 = decode($2, 'hex')
            order by owner, lineage_id
          `, [
            medusaSharedLineage.identity.deploymentId,
            medusaSharedLineage.identity.artifactSha256,
          ]);
          const expectedStored = coordinateArtifacts.map(artifact => ({
            owner: artifact.identity.owner,
            lineageId: artifact.identity.lineageId,
            artifactSha256: artifact.identity.artifactSha256,
            canonicalBytesHex: Buffer.from(
              requireCapturedEvidence(artifact).canonicalBytes,
            ).toString("hex"),
          })).sort(compareStoredArtifactCoordinates);
          expect(stored.rows).toEqual(expectedStored);
          expect(await countAllDependencyRows(persistence)).toBe(0);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    }, 180_000);

    it("rolls back a parent queued before its missing dependency", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const dependency = await captureArtifact({
          lineageId: "catalog-parent-first-dependency",
        });
        const parent = await captureArtifact({
          lineageId: "catalog-parent-first",
          dependencies: [dependency.identity],
        });
        const preparedParent = prepareAdmissionOrThrow(parent);
        const preparedDependency = prepareAdmissionOrThrow(dependency);
        let parentAdmission:
          ReturnType<typeof admitPreparedArtifactResult> | undefined;
        let dependencyAdmission:
          ReturnType<typeof admitPreparedArtifactResult> | undefined;

        await runWithBlockedDeploymentLock(
          persistence,
          parent.identity.deploymentId,
          1,
          track => {
            parentAdmission = track(admitPreparedArtifactResult(
              repository,
              preparedParent,
            ));
          },
          async (lock, firstWaiters, track) => {
            dependencyAdmission = track(admitPreparedArtifactResult(
              repository,
              preparedDependency,
            ));
            const allWaiters =
              await waitForBlockedPostgresDeploymentLockWaiters(
              persistence,
              lock,
              2,
            );
            expectOrderedDeploymentLockQueue(
              lock,
              firstWaiters,
              allWaiters,
            );
          },
        );
        if (parentAdmission === undefined) {
          throw new Error("Expected parent admission to start.");
        }
        if (dependencyAdmission === undefined) {
          throw new Error("Expected dependency admission to start.");
        }
        const [parentOutcome, dependencyOutcome] = await Promise.all([
          parentAdmission,
          dependencyAdmission,
        ]);
        expect(Result.isFailure(parentOutcome)).toBe(true);
        if (Result.isSuccess(parentOutcome)) {
          throw new Error("Expected the parent admission to fail.");
        }
        expect(parentOutcome.failure).toMatchObject({
          operation: "admit",
          reason: "dependencyMissing",
          message: "Framework schema artifact dependency is missing",
          retryable: false,
          identity: parent.identity,
          dependencyIdentity: dependency.identity,
          dependencyOrdinal: 0,
        });
        expect(Object.hasOwn(parentOutcome.failure, "cause")).toBe(false);
        expect(Result.isSuccess(dependencyOutcome)).toBe(true);
        if (Result.isFailure(dependencyOutcome)) {
          throw dependencyOutcome.failure;
        }
        expect(dependencyOutcome.success).toEqual({
          status: "created",
          artifact: dependency,
        });
        expect(await countArtifactRows(persistence, parent)).toBe(0);
        expect(await countArtifactRows(persistence, dependency)).toBe(1);
        expect(await countAllDependencyRows(persistence)).toBe(0);
      });
    }, 180_000);

    it("observes a dependency committed by the earlier queued waiter", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const dependency = await captureArtifact({
          lineageId: "catalog-dependency-first-dependency",
        });
        const parent = await captureArtifact({
          lineageId: "catalog-dependency-first",
          dependencies: [dependency.identity],
        });
        const preparedDependency = prepareAdmissionOrThrow(dependency);
        const preparedParent = prepareAdmissionOrThrow(parent);
        let dependencyAdmission:
          ReturnType<typeof admitPreparedArtifactResult> | undefined;
        let parentAdmission:
          ReturnType<typeof admitPreparedArtifactResult> | undefined;

        await runWithBlockedDeploymentLock(
          persistence,
          parent.identity.deploymentId,
          1,
          track => {
            dependencyAdmission = track(admitPreparedArtifactResult(
              repository,
              preparedDependency,
            ));
          },
          async (lock, firstWaiters, track) => {
            parentAdmission = track(admitPreparedArtifactResult(
              repository,
              preparedParent,
            ));
            const allWaiters =
              await waitForBlockedPostgresDeploymentLockWaiters(
              persistence,
              lock,
              2,
            );
            expectOrderedDeploymentLockQueue(
              lock,
              firstWaiters,
              allWaiters,
            );
          },
        );
        if (dependencyAdmission === undefined) {
          throw new Error("Expected dependency admission to start.");
        }
        if (parentAdmission === undefined) {
          throw new Error("Expected parent admission to start.");
        }
        const [dependencyOutcome, parentOutcome] = await Promise.all([
          dependencyAdmission,
          parentAdmission,
        ]);
        expect(Result.isSuccess(dependencyOutcome)).toBe(true);
        if (Result.isFailure(dependencyOutcome)) {
          throw dependencyOutcome.failure;
        }
        expect(dependencyOutcome.success).toEqual({
          status: "created",
          artifact: dependency,
        });
        expect(Result.isSuccess(parentOutcome)).toBe(true);
        if (Result.isFailure(parentOutcome)) throw parentOutcome.failure;
        expect(parentOutcome.success).toEqual({
          status: "created",
          artifact: parent,
        });
        expect(await countArtifactRows(persistence, dependency)).toBe(1);
        expect(await countArtifactRows(persistence, parent)).toBe(1);
        expect(await countDependencyRows(persistence, parent)).toBe(1);
      });
    }, 180_000);

    it("rolls back an inserted parent when dependency-edge insertion fails", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        await insertDeployment(persistence);
        const repository = makePostgresArtifactRepository(persistence);
        const dependency = await captureArtifact({
          lineageId: "catalog-post-write-dependency",
        });
        expect((await admitArtifact(repository, dependency)).status)
          .toBe("created");
        const parent = await captureArtifact({
          lineageId: "catalog-post-write-parent",
          dependencies: [dependency.identity],
        });
        const preparedParent = prepareAdmissionOrThrow(parent);
        await persistence.query(`
          create function fx_test_reject_framework_dependency_insert()
          returns trigger
          language plpgsql
          as $$
          begin
            if not exists (
              select 1
              from ${ARTIFACT_TABLE} as parent
              where parent.artifact_storage_id = new.artifact_storage_id
                and parent.deployment_id = new.deployment_id
                and parent.owner = new.owner
                and parent.lineage_id = new.artifact_lineage_id
            ) then
              raise exception
                'parent artifact was not visible before dependency insert';
            end if;
            raise exception 'forced framework dependency insert failure';
          end;
          $$;

          create trigger fx_test_reject_framework_dependency_insert
          before insert on ${DEPENDENCY_TABLE}
          for each row execute function
            fx_test_reject_framework_dependency_insert();
        `);
        let failedOutcome:
          Awaited<ReturnType<typeof admitPreparedArtifactResult>> | undefined;
        try {
          failedOutcome = await admitPreparedArtifactResult(
            repository,
            preparedParent,
          );
        } finally {
          await persistence.query(`
            drop trigger if exists
              fx_test_reject_framework_dependency_insert
              on ${DEPENDENCY_TABLE};
            drop function if exists
              fx_test_reject_framework_dependency_insert();
          `);
        }
        if (failedOutcome === undefined) {
          throw new Error("Expected a captured dependency-insert outcome.");
        }
        expect(Result.isFailure(failedOutcome)).toBe(true);
        if (Result.isSuccess(failedOutcome)) {
          throw new Error("Expected dependency-edge insertion to fail.");
        }
        expect(failedOutcome.failure).toMatchObject({
          operation: "admit",
          reason: "resourceFailure",
          message: "Framework schema artifact admission persistence failed",
          retryable: false,
          identity: parent.identity,
          stage: "insertDependencies",
          cause: expect.objectContaining({
            cause: expect.objectContaining({
              code: "P0001",
              message: "forced framework dependency insert failure",
            }),
          }),
        });
        expect(await countArtifactRows(persistence, dependency)).toBe(1);
        expect(await countArtifactRows(persistence, parent)).toBe(0);
        expect(await countAllDependencyRows(persistence)).toBe(0);

        expect(await admitPreparedArtifact(repository, preparedParent))
          .toEqual({ status: "created", artifact: parent });
        expect(await countArtifactRows(persistence, dependency)).toBe(1);
        expect(await countArtifactRows(persistence, parent)).toBe(1);
        expect(await countDependencyRows(persistence, parent)).toBe(1);
      });
    }, 180_000);

    it("does not serialize an independent deployment behind a held lock", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await expectPostgres18OrdinaryRole(persistence);
        const blockedDeploymentId = `${DEFAULT_DEPLOYMENT_ID}-blocked`;
        const independentDeploymentId = `${DEFAULT_DEPLOYMENT_ID}-independent`;
        await insertDeployment(persistence, blockedDeploymentId);
        await insertDeployment(persistence, independentDeploymentId);
        const repository = makePostgresArtifactRepository(persistence);
        const blocked = await captureArtifact({
          deploymentId: blockedDeploymentId,
          lineageId: "catalog-blocked-deployment",
        });
        const independent = await captureArtifact({
          deploymentId: independentDeploymentId,
          lineageId: "catalog-independent-deployment",
        });
        const preparedBlocked = prepareAdmissionOrThrow(blocked);
        const preparedIndependent = prepareAdmissionOrThrow(independent);
        let blockedAdmission:
          ReturnType<typeof admitPreparedArtifactResult> | undefined;

        await runWithBlockedDeploymentLock(
          persistence,
          blockedDeploymentId,
          1,
          track => {
            blockedAdmission = track(admitPreparedArtifactResult(
              repository,
              preparedBlocked,
            ));
          },
          async (lock, firstWaiters, track) => {
            expect(firstWaiters).toHaveLength(1);
            expect(firstWaiters[0]?.blockerPids).toContain(lock.blockerPid);
            const independentOutcome = await track(
              admitPreparedArtifactResult(
                repository,
                preparedIndependent,
              ),
            );
            expect(Result.isSuccess(independentOutcome)).toBe(true);
            if (Result.isFailure(independentOutcome)) {
              throw independentOutcome.failure;
            }
            expect(independentOutcome.success).toEqual({
              status: "created",
              artifact: independent,
            });
            expect(await countArtifactRows(persistence, blocked)).toBe(0);
            expect(await countArtifactRows(persistence, independent)).toBe(1);
            const stillBlocked =
              await waitForBlockedPostgresDeploymentLockWaiters(
                persistence,
                lock,
                1,
              );
            expect(stillBlocked).toHaveLength(1);
            expect(stillBlocked[0]?.waiterPid).toBe(
              firstWaiters[0]?.waiterPid,
            );
          },
        );
        if (blockedAdmission === undefined) {
          throw new Error("Expected blocked admission to start.");
        }
        const blockedOutcome = await blockedAdmission;
        expect(Result.isSuccess(blockedOutcome)).toBe(true);
        if (Result.isFailure(blockedOutcome)) throw blockedOutcome.failure;
        expect(blockedOutcome.success).toEqual({
          status: "created",
          artifact: blocked,
        });
        expect(await countArtifactRows(persistence, blocked)).toBe(1);
        expect(await countArtifactRows(persistence, independent)).toBe(1);
        expect(await countDependencyRows(persistence, blocked)).toBe(0);
        expect(await countDependencyRows(persistence, independent)).toBe(0);
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
    deploymentId: DEFAULT_DEPLOYMENT_ID,
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
  return admitPreparedArtifact(repository, prepareAdmissionOrThrow(artifact));
}

function prepareAdmissionOrThrow(
  artifact: FrameworkSchemaArtifact,
): PreparedFrameworkSchemaArtifactAdmission {
  return Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact));
}

function admitPreparedArtifact(
  repository: FrameworkSchemaArtifactRepository,
  prepared: PreparedFrameworkSchemaArtifactAdmission,
) {
  return runEffect(admitFrameworkSchemaArtifactEffect(
    repository,
    prepared,
  ));
}

function admitPreparedArtifactResult(
  repository: FrameworkSchemaArtifactRepository,
  prepared: PreparedFrameworkSchemaArtifactAdmission,
) {
  return runEffect(Effect.result(
    admitFrameworkSchemaArtifactEffect(
      repository,
      prepared,
    ),
  ));
}

async function insertDeployment(
  persistence: PostgresFlarexPersistence,
  deploymentId: string = DEFAULT_DEPLOYMENT_ID,
): Promise<void> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values ($1, $2)
  `, [deploymentId, `project-for-${deploymentId}`]);
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

async function countDependencyRows(
  persistence: PostgresFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(`
    select count(*)::int as count
    from ${DEPENDENCY_TABLE} as edge
    join ${ARTIFACT_TABLE} as parent
      on parent.artifact_storage_id = edge.artifact_storage_id
    where parent.deployment_id = $1
      and parent.owner = $2
      and parent.lineage_id = $3
      and parent.artifact_sha256 = decode($4, 'hex')
  `, [
    artifact.identity.deploymentId,
    artifact.identity.owner,
    artifact.identity.lineageId,
    artifact.identity.artifactSha256,
  ]);
  return result.rows[0]?.count ?? 0;
}

async function countAllDependencyRows(
  persistence: PostgresFlarexPersistence,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(`
    select count(*)::int as count
    from ${DEPENDENCY_TABLE}
  `);
  return result.rows[0]?.count ?? 0;
}

function requireCapturedEvidence(artifact: FrameworkSchemaArtifact) {
  const evidence = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (evidence === undefined) {
    throw new Error("Expected authentic framework artifact evidence.");
  }
  return evidence;
}

function cryptoReturning(bytes: Uint8Array): object {
  const stableBytes = Uint8Array.from(bytes);
  return Object.freeze({
    subtle: Object.freeze({
      digest(): Promise<ArrayBuffer> {
        return Promise.resolve(Uint8Array.from(stableBytes).buffer);
      },
    }),
  });
}

function compareStoredArtifactCoordinates(
  left: Readonly<{ owner: string; lineageId: string }>,
  right: Readonly<{ owner: string; lineageId: string }>,
): number {
  if (left.owner !== right.owner) return left.owner < right.owner ? -1 : 1;
  if (left.lineageId === right.lineageId) return 0;
  return left.lineageId < right.lineageId ? -1 : 1;
}

function expectOrderedDeploymentLockQueue(
  lock: HeldPostgresDeploymentLock,
  firstWaiters: readonly BlockedPostgresDeploymentLockWaiter[],
  allWaiters: readonly BlockedPostgresDeploymentLockWaiter[],
): void {
  expect(firstWaiters).toHaveLength(1);
  const firstWaiter = firstWaiters[0];
  if (firstWaiter === undefined) {
    throw new Error("Expected the first deployment-lock waiter.");
  }
  expect(firstWaiter.blockerPids).toContain(lock.blockerPid);
  expect(allWaiters).toHaveLength(2);
  expect(allWaiters).toContainEqual(firstWaiter);
  const secondWaiter = allWaiters.find(
    waiter => waiter.waiterPid !== firstWaiter.waiterPid,
  );
  expect(secondWaiter?.blockerPids).toContain(firstWaiter.waiterPid);
}

type TrackBlockedOperation = <Value>(operation: Promise<Value>) =>
  Promise<Value>;

async function runWithBlockedDeploymentLock(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
  expectedBlocked: number,
  startOperations: (track: TrackBlockedOperation) => void,
  whileBlocked: (
    lock: HeldPostgresDeploymentLock,
    waiters: readonly BlockedPostgresDeploymentLockWaiter[],
    track: TrackBlockedOperation,
  ) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const lock = await acquirePostgresDeploymentLock(
    persistence,
    deploymentId,
  );
  const operations: Promise<unknown>[] = [];
  const track: TrackBlockedOperation = operation => {
    operations.push(operation);
    void operation.catch(() => undefined);
    return operation;
  };
  let released = false;
  let setupError: unknown;
  try {
    startOperations(track);
    const waiters = await waitForBlockedPostgresDeploymentLockWaiters(
      persistence,
      lock,
      expectedBlocked,
    );
    await whileBlocked(lock, waiters, track);
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
