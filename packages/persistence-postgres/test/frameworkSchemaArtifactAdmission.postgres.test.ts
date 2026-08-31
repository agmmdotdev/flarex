import { setTimeout as delay } from "node:timers/promises";

import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { admitFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/admission";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import {
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  makeFrameworkSchemaArtifactControlSessionStarter,
  type FrameworkSchemaArtifactControlDeadlineKind,
  type FrameworkSchemaArtifactControlSessionPhase,
} from "../src/frameworkSchema/artifact/controlSession";
import { FrameworkSchemaArtifactError } from
  "../src/frameworkSchema/artifact/errors";
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
  type FrameworkSchemaArtifactRepositoryTimeoutPolicy,
  type PreparedFrameworkSchemaArtifactAdmission,
} from "../src/frameworkSchema/artifact/repository";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  prepareSchemaVersionArtifactEffect,
  type PreparedSchemaVersionArtifact,
} from "../src/schemaVersionArtifacts";
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
const ARTIFACT_DEADLOCK_ADVISORY_CLASS_ID = 80_932;
const ARTIFACT_INTERRUPT_ADVISORY_CLASS_ID = 80_931;
const CONCURRENT_ADMISSIONS = 8;
const DEFAULT_DEPLOYMENT_ID = "deployment-framework-admission-pg";
const SUPPORTED_LOCK_ORDER_SCENARIOS = [
  {
    label: "framework artifact first",
    holder: "framework",
  },
  {
    label: "Application schema-version artifact first",
    holder: "application",
  },
] as const satisfies readonly Readonly<{
  label: string;
  holder: "application" | "framework";
}>[];
const COMMIT_SETTLEMENT_RECOVERY_SCENARIOS = [
  {
    label: "before PostgreSQL receives COMMIT",
    faultEdge: "before",
    expectedStatus: "created",
  },
  {
    label: "after PostgreSQL acknowledges COMMIT",
    faultEdge: "after",
    expectedStatus: "existing",
  },
] as const satisfies readonly Readonly<{
  label: string;
  faultEdge: "before" | "after";
  expectedStatus: "created" | "existing";
}>[];

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

    it.each(SUPPORTED_LOCK_ORDER_SCENARIOS)(
      "keeps the supported cross-owner lock order acyclic with $label",
      async ({ holder }) => {
        await withTemporaryPostgresPersistence(async persistence => {
          await expectPostgres18OrdinaryRole(persistence);
          await insertDeployment(persistence);
          const repository = makePostgresArtifactRepository(persistence);
          const suffix = holder === "framework"
            ? "framework_first"
            : "application_first";
          const dependency = await captureArtifact({
            lineageId: `catalog-deadlock-${suffix}-dependency`,
          });
          expect(await admitArtifact(repository, dependency)).toEqual({
            status: "created",
            artifact: dependency,
          });
          const parent = await captureArtifact({
            lineageId: `catalog-deadlock-${suffix}-parent`,
            dependencies: [dependency.identity],
          });
          const preparedParent = prepareAdmissionOrThrow(parent);
          const applicationArtifact = await runEffect(
            prepareSchemaVersionArtifactEffect({
              deploymentId: parent.identity.deploymentId,
              schemaVersionId: CatalogSchemaVersionIdSchema.make(
                `schema_artifact_deadlock_${suffix}`,
              ),
              version: CatalogSchemaVersionSchema.make(1),
              manifest: {
                tables: [{ name: `deadlock_${suffix}` }],
              },
            }),
          );

          const observed = await runSupportedCrossOwnerLockOrder({
            persistence,
            holder,
            frameworkArtifact: parent,
            applicationArtifact,
            startFramework: () => admitPreparedArtifact(
              repository,
              preparedParent,
            ),
            startApplication: () => ensureApplicationSchemaVersionArtifact(
              persistence,
              applicationArtifact,
            ),
          });

          expect(observed.frameworkResult).toEqual({
            status: "created",
            artifact: parent,
          });
          expect(observed.applicationResult).toMatchObject({
            status: "created",
            artifact: {
              deploymentId: applicationArtifact.deploymentId,
              schemaVersionId: applicationArtifact.schemaVersionId,
              version: applicationArtifact.version,
            },
          });
          expect(observed.holderBackendPid).not.toBe(
            observed.waiterBackendPid,
          );
          expect(await countArtifactRows(persistence, dependency)).toBe(1);
          expect(await countArtifactRows(persistence, parent)).toBe(1);
          expect(await countDependencyRows(persistence, parent)).toBe(1);
          expect(await countApplicationSchemaVersionRows(
            persistence,
            applicationArtifact,
          )).toBe(1);
          expect(await admitArtifact(repository, parent)).toEqual({
            status: "existing",
            artifact: parent,
          });
          const applicationReplay =
            await ensureApplicationSchemaVersionArtifact(
              persistence,
              applicationArtifact,
            );
          expect(applicationReplay).toEqual({
            status: "existing",
            artifact: observed.applicationResult.artifact,
          });
          expect(await countAllDependencyRows(persistence)).toBe(1);
        });
      },
      180_000,
    );

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

    it("expires a queued native pool acquisition and destroys the late backend", async () => {
      await expectPostgresArtifactAcquisitionDeadline();
    }, 180_000);

    it("lets native lock_timeout abort the deployment-row waiter", async () => {
      await expectPostgresArtifactLockTimeout();
    }, 180_000);

    it("lets native statement_timeout abort dependency-edge insertion", async () => {
      await expectPostgresArtifactStatementTimeout();
    }, 180_000);

    it("destroys and drains active native SQL when the host deadline expires", async () => {
      await expectPostgresArtifactActiveStatementDeadline();
    }, 180_000);

    it("stops after one native recovery when its work deadline expires", async () => {
      await expectPostgresArtifactRecoveryDeadline();
    }, 180_000);

    it("expires detached optimistic reconstruction without discarding its released backend", async () => {
      await expectPostgresArtifactOptimisticReconstructionDeadline();
    }, 180_000);

    it("discards the post-resolution read backend when reconstruction expires", async () => {
      await expectPostgresArtifactPostResolutionReconstructionDeadline();
    }, 180_000);

    for (const scenario of COMMIT_SETTLEMENT_RECOVERY_SCENARIOS) {
      it(`recovers on a distinct backend ${scenario.label}`, async () => {
        await expectPostgresCommitSettlementRecovery(scenario);
      }, 180_000);
    }

    it("drains blocked callback SQL and rolls back before re-emitting interruption", async () => {
      await expectPostgresCallbackInterruption();
    }, 180_000);

    it("drains blocked COMMIT and recovers before re-emitting interruption", async () => {
      await expectPostgresCommitInterruptionRecovery();
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
  options: PostgresArtifactRepositoryTestOptions = {},
): FrameworkSchemaArtifactRepository {
  const controlDb = persistence.drizzle;
  const timeoutPolicy = options.timeoutPolicy ??
    DEFAULT_POSTGRES_ARTIFACT_TIMEOUT_POLICY;
  return Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(
        options.controlPool ?? persistence.pool,
        options.controlSessionOptions,
      ),
    }),
    ...timeoutPolicy,
  }));
}

type PostgresArtifactControlPool = Parameters<
  typeof makePostgresFrameworkSchemaArtifactControlSessionDriver
>[0];

type PostgresArtifactControlPoolConnect = Parameters<
  PostgresArtifactControlPool["connect"]
>[0];

type PostgresArtifactControlSessionOptions = NonNullable<Parameters<
  typeof makePostgresFrameworkSchemaArtifactControlSessionDriver
>[1]>;

interface PostgresArtifactRepositoryTestOptions {
  readonly controlPool?: PostgresArtifactControlPool;
  readonly controlSessionOptions?: PostgresArtifactControlSessionOptions;
  readonly timeoutPolicy?: FrameworkSchemaArtifactRepositoryTimeoutPolicy;
}

const DEFAULT_POSTGRES_ARTIFACT_TIMEOUT_POLICY = Object.freeze({
  readTimeoutMilliseconds: 10_000,
  attemptTimeoutMilliseconds: 30_000,
  recoveryTimeoutMilliseconds: 30_000,
  lockTimeoutMilliseconds: 10_000,
}) satisfies FrameworkSchemaArtifactRepositoryTimeoutPolicy;

interface CapturedTestFailure {
  readonly cause: unknown;
}

function captureTestFailure(
  operation: Promise<void>,
): Promise<CapturedTestFailure | undefined> {
  return operation.then(
    () => undefined,
    cause => ({ cause }),
  );
}

async function runSupportedCrossOwnerLockOrder(input: Readonly<{
  persistence: PostgresFlarexPersistence;
  holder: "application" | "framework";
  frameworkArtifact: FrameworkSchemaArtifact;
  applicationArtifact: PreparedSchemaVersionArtifact;
  startFramework: () => ReturnType<typeof admitPreparedArtifact>;
  startApplication: () => ReturnType<
    typeof ensureApplicationSchemaVersionArtifact
  >;
}>): Promise<Readonly<{
  frameworkResult: Awaited<ReturnType<typeof admitPreparedArtifact>>;
  applicationResult: Awaited<ReturnType<
    typeof ensureApplicationSchemaVersionArtifact
  >>;
  holderBackendPid: number;
  waiterBackendPid: number;
}>> {
  let frameworkOperation:
    ReturnType<typeof admitPreparedArtifact> | undefined;
  let applicationOperation:
    ReturnType<typeof ensureApplicationSchemaVersionArtifact> | undefined;
  let holderBackendPid: number | undefined;
  let waiterBackendPid: number | undefined;
  const trackedOperations: Promise<unknown>[] = [];
  const track = <Value>(operation: Promise<Value>): Promise<Value> => {
    trackedOperations.push(operation);
    void operation.catch(() => undefined);
    return operation;
  };
  let primaryFailure: CapturedTestFailure | undefined;
  try {
    await withPostgresArtifactAdvisoryBlocker(
      input.persistence,
      async (blockerPid, releaseBlocker) => {
        let coordinationFailure: CapturedTestFailure | undefined;
        try {
          await installPostgresSupportedLockOrderBarrier(
            input.persistence,
            input.holder,
            blockerPid,
            input.frameworkArtifact,
            input.applicationArtifact,
          );
          if (input.holder === "framework") {
            frameworkOperation = track(input.startFramework());
          } else {
            applicationOperation = track(input.startApplication());
          }
          const holderBlocked = await waitForPostgresBackendBlockedBy(
            input.persistence,
            blockerPid,
          );
          holderBackendPid = holderBlocked.waiterPid;
          const expectedHolderTable = input.holder === "framework"
            ? ARTIFACT_TABLE
            : "fx_control_schema_version";
          expect(holderBlocked.query.toLowerCase()).toContain(
            expectedHolderTable,
          );

          if (input.holder === "framework") {
            applicationOperation = track(input.startApplication());
          } else {
            frameworkOperation = track(input.startFramework());
          }
          const deploymentWaiter =
            await waitForPostgresDeploymentLockWaiterBlockedBy(
              input.persistence,
              holderBlocked.waiterPid,
            );
          waiterBackendPid = deploymentWaiter.waiterPid;
          expect(deploymentWaiter.blockerPids).toContain(
            holderBlocked.waiterPid,
          );
          expect(deploymentWaiter.blockerPids).not.toContain(
            deploymentWaiter.waiterPid,
          );
          expect(new Set([
            blockerPid,
            holderBlocked.waiterPid,
            deploymentWaiter.waiterPid,
          ]).size).toBe(3);
        } catch (cause) {
          coordinationFailure = { cause };
        }

        const releaseFailure = await captureTestFailure(releaseBlocker());
        const settlements = await Promise.allSettled(trackedOperations);
        const operationCauses = settlements.flatMap(settlement =>
          settlement.status === "rejected" ? [settlement.reason] : []
        );
        const causes = [
          ...operationCauses,
          ...(coordinationFailure === undefined
            ? []
            : [coordinationFailure.cause]),
          ...(releaseFailure === undefined ? [] : [releaseFailure.cause]),
        ];
        if (causes.length === 1) throw causes[0];
        if (causes.length > 1) {
          throw new AggregateError(
            causes,
            "Supported cross-owner lock-order evidence failed.",
          );
        }
      },
      ARTIFACT_DEADLOCK_ADVISORY_CLASS_ID,
    );
  } catch (cause) {
    primaryFailure = { cause };
  }
  const cleanupFailure = await captureTestFailure(
    dropPostgresSupportedLockOrderBarrier(input.persistence),
  );
  if (primaryFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure.cause, cleanupFailure.cause],
      "Supported lock-order operation and barrier cleanup both failed.",
    );
  }
  if (primaryFailure !== undefined) throw primaryFailure.cause;
  if (cleanupFailure !== undefined) throw cleanupFailure.cause;

  if (
    frameworkOperation === undefined ||
    applicationOperation === undefined ||
    holderBackendPid === undefined ||
    waiterBackendPid === undefined
  ) {
    throw new Error("Expected both supported lock-order operations to run.");
  }
  const [frameworkResult, applicationResult] = await Promise.all([
    frameworkOperation,
    applicationOperation,
  ]);
  const remainingWaits = await input.persistence.query<{ count: number }>(`
    select count(*)::int as count
    from pg_stat_activity
    where pid = any($1::int[])
      and wait_event_type = 'Lock'
  `, [[holderBackendPid, waiterBackendPid]]);
  expect(remainingWaits.rows).toEqual([{ count: 0 }]);
  return Object.freeze({
    frameworkResult,
    applicationResult,
    holderBackendPid,
    waiterBackendPid,
  });
}

async function expectPostgresArtifactAcquisitionDeadline(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const artifact = await captureArtifact({
      lineageId: "catalog-acquisition-deadline",
    });
    const prepared = prepareAdmissionOrThrow(artifact);
    const pool = await makeDedicatedPostgresControlPool(persistence, 1);
    const holder = await pool.connect();
    const holderPid = await readPostgresBackendPid(holder);
    const observedPool = observePostgresControlPool(persistence, pool);
    let holderReleased = false;
    try {
      const repository = makePostgresArtifactRepository(persistence, {
        controlPool: observedPool.controlPool,
        timeoutPolicy: {
          readTimeoutMilliseconds: 30_000,
          attemptTimeoutMilliseconds: 30_000,
          recoveryTimeoutMilliseconds: 30_000,
          lockTimeoutMilliseconds: 30_000,
        },
      });
      const exit = await expireEffectAfterGate(
        admitFrameworkSchemaArtifactEffect(repository, prepared),
        () => waitForPostgresPoolWaiter(pool),
        30_000,
      );
      const failure = expectSingleFrameworkArtifactFailure(exit);
      expect(failure).toMatchObject({
        operation: "admit",
        reason: "resourceFailure",
        retryable: false,
        identity: artifact.identity,
        stage: "readArtifact",
      });
      expectControlSessionDeadlineCause(
        failure,
        "acquire",
        "initial",
        "acquire",
      );
      expect(await countArtifactRows(persistence, artifact)).toBe(0);

      holder.release();
      holderReleased = true;
      await waitForDiscardedPostgresBackend(
        persistence,
        observedPool,
        holderPid,
      );
      expect(observedPool.removedBackendPids()).toEqual([holderPid]);
    } finally {
      if (!holderReleased) holder.release(true);
      observedPool.close();
      await pool.end();
    }

    const stableRepository = makePostgresArtifactRepository(persistence);
    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "created",
      artifact,
    });
    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "existing",
      artifact,
    });
    expect(await countArtifactRows(persistence, artifact)).toBe(1);
  });
}

async function expectPostgresArtifactLockTimeout(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const artifact = await captureArtifact({
      lineageId: "catalog-native-lock-timeout",
    });
    const prepared = prepareAdmissionOrThrow(artifact);
    const lock = await acquirePostgresDeploymentLock(
      persistence,
      artifact.identity.deploymentId,
    );
    const observedPool = observePostgresControlPool(persistence);
    const lifecycleEvents: string[] = [];
    let lockReleased = false;
    try {
      const repository = makePostgresArtifactRepository(persistence, {
        controlPool: observedPool.controlPool,
        controlSessionOptions: {
          lifecycleFault: ({ phase, edge }) => {
            lifecycleEvents.push(`${phase}:${edge}`);
          },
        },
        timeoutPolicy: {
          readTimeoutMilliseconds: 5_000,
          attemptTimeoutMilliseconds: 5_000,
          recoveryTimeoutMilliseconds: 5_000,
          lockTimeoutMilliseconds: 2_000,
        },
      });
      const observed = await runEffectUnderFrozenClockAfterGate(
        admitFrameworkSchemaArtifactEffect(repository, prepared),
        async () => {
          const waiters = await waitForBlockedPostgresDeploymentLockWaiters(
            persistence,
            lock,
            1,
          );
          const waiter = waiters[0];
          if (waiter === undefined) {
            throw new Error("Expected a native deployment-lock waiter.");
          }
          return waiter;
        },
      );
      expect(observed.observation.blockerPids).toContain(lock.blockerPid);
      const failure = expectSingleFrameworkArtifactFailure(observed.exit);
      expectPostgresSqlStateFailure(
        failure,
        artifact,
        "lockDeployment",
        "55P03",
      );
      expect(lifecycleEvents).toContain("rollback:before");
      expect(lifecycleEvents).toContain("rollback:after");
      expect(lifecycleEvents.slice(-2)).toEqual([
        "release:before",
        "release:after",
      ]);
      expect(lifecycleEvents.some(event => event.startsWith("quarantine:")))
        .toBe(false);
      expect(observedPool.removedBackendPids()).toEqual([]);
      expect(await countArtifactRows(persistence, artifact)).toBe(0);
      expect(await countDependencyRows(persistence, artifact)).toBe(0);
    } finally {
      await rollbackAndReleasePostgresClient(lock.client);
      lockReleased = true;
      observedPool.close();
    }
    expect(lockReleased).toBe(true);

    const stableRepository = makePostgresArtifactRepository(persistence);
    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "created",
      artifact,
    });
    expect(await countArtifactRows(persistence, artifact)).toBe(1);
  });
}

async function expectPostgresArtifactStatementTimeout(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const dependency = await captureArtifact({
      lineageId: "catalog-native-statement-timeout-dependency",
    });
    expect(await admitArtifact(stableRepository, dependency)).toEqual({
      status: "created",
      artifact: dependency,
    });
    const parent = await captureArtifact({
      lineageId: "catalog-native-statement-timeout-parent",
      dependencies: [dependency.identity],
    });
    const preparedParent = prepareAdmissionOrThrow(parent);
    const observedPool = observePostgresControlPool(persistence);
    const lifecycleEvents: string[] = [];
    await installPostgresArtifactStatementTimeoutBarrier(persistence, parent);
    try {
      const repository = makePostgresArtifactRepository(persistence, {
        controlPool: observedPool.controlPool,
        controlSessionOptions: {
          lifecycleFault: ({ phase, edge }) => {
            lifecycleEvents.push(`${phase}:${edge}`);
          },
        },
        timeoutPolicy: {
          readTimeoutMilliseconds: 5_000,
          attemptTimeoutMilliseconds: 5_000,
          recoveryTimeoutMilliseconds: 5_000,
          lockTimeoutMilliseconds: 5_000,
        },
      });
      const observed = await runEffectUnderFrozenClockAfterGate(
        admitFrameworkSchemaArtifactEffect(repository, preparedParent),
        () => waitForPostgresSleepingStatement(
          persistence,
          DEPENDENCY_TABLE,
        ),
      );
      expect(observed.observation.query.toLowerCase()).toContain(
        DEPENDENCY_TABLE,
      );
      const failure = expectSingleFrameworkArtifactFailure(observed.exit);
      expectPostgresSqlStateFailure(
        failure,
        parent,
        "insertDependencies",
        "57014",
      );
      expect(lifecycleEvents).toContain("rollback:before");
      expect(lifecycleEvents).toContain("rollback:after");
      expect(lifecycleEvents.slice(-2)).toEqual([
        "release:before",
        "release:after",
      ]);
      expect(lifecycleEvents.some(event => event.startsWith("quarantine:")))
        .toBe(false);
      expect(observedPool.removedBackendPids()).toEqual([]);
      expect(await countArtifactRows(persistence, dependency)).toBe(1);
      expect(await countArtifactRows(persistence, parent)).toBe(0);
      expect(await countAllDependencyRows(persistence)).toBe(0);
    } finally {
      observedPool.close();
      await dropPostgresArtifactStatementTimeoutBarrier(persistence);
    }

    expect(await admitArtifact(stableRepository, parent)).toEqual({
      status: "created",
      artifact: parent,
    });
    expect(await admitArtifact(stableRepository, parent)).toEqual({
      status: "existing",
      artifact: parent,
    });
    expect(await countArtifactRows(persistence, parent)).toBe(1);
    expect(await countDependencyRows(persistence, parent)).toBe(1);
  });
}

async function expectPostgresArtifactActiveStatementDeadline(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const artifact = await captureArtifact({
      lineageId: "catalog-active-statement-deadline",
    });
    const prepared = prepareAdmissionOrThrow(artifact);
    const controlPool = await makeDedicatedPostgresControlPool(persistence, 1);
    const observedPool = observePostgresControlPool(persistence, controlPool);
    const lifecycleEvents: string[] = [];
    const transactionBackendPids: number[] = [];
    try {
      await withPostgresArtifactAdvisoryBlocker(
        persistence,
        async (blockerPid) => {
          await installPostgresArtifactActiveStatementBarrier(
            persistence,
            blockerPid,
            artifact,
          );
          const repository = makePostgresArtifactRepository(persistence, {
            controlPool: observedPool.controlPool,
            controlSessionOptions: {
              lifecycleFault: ({ phase, edge, client }) => {
                lifecycleEvents.push(`${phase}:${edge}`);
                if (phase === "begin" && edge === "before") {
                  transactionBackendPids.push(
                    observedPool.backendPidFor(client),
                  );
                }
              },
            },
            timeoutPolicy: {
              readTimeoutMilliseconds: 30_000,
              attemptTimeoutMilliseconds: 30_000,
              recoveryTimeoutMilliseconds: 30_000,
              lockTimeoutMilliseconds: 30_000,
            },
          });
          const observed = await expireEffectAfterGateWithObservation(
            admitFrameworkSchemaArtifactEffect(repository, prepared),
            () => waitForPostgresBackendBlockedBy(persistence, blockerPid),
            30_000,
          );
          expect(observed.observation.query.toLowerCase()).toContain(
            ARTIFACT_TABLE,
          );
          expect(observed.observation.waiterPid).toBe(
            transactionBackendPids[0],
          );
          const failure = expectSingleFrameworkArtifactFailure(observed.exit);
          expect(failure).toMatchObject({
            operation: "admit",
            reason: "resourceFailure",
            retryable: false,
            identity: artifact.identity,
            stage: "insertArtifact",
          });
          expectControlSessionDeadlineCause(
            failure,
            "callback",
            "initial",
            "callback",
          );
          const backendPid = transactionBackendPids[0];
          if (backendPid === undefined) {
            throw new Error("Expected an active-statement backend PID.");
          }
          const immediateActivity = await persistence.query<{
            state: string;
          }>(`
            select state from pg_stat_activity where pid = $1
          `, [backendPid]);
          expect({
            removedBackendPids: observedPool.removedBackendPids(),
            activity: immediateActivity.rows,
            lifecycleEvents,
          }).toEqual({
            removedBackendPids: [backendPid],
            activity: [],
            lifecycleEvents: expect.any(Array),
          });
          await waitForDiscardedPostgresBackend(
            persistence,
            observedPool,
            backendPid,
          );
          expect(observedPool.removedBackendPids()).toEqual([backendPid]);
          expect(lifecycleEvents).toContain("quarantine:before");
          expect(lifecycleEvents).toContain("quarantine:after");
          expect(await countArtifactRows(persistence, artifact)).toBe(0);
        },
      );
    } finally {
      observedPool.close();
      await controlPool.end();
      await dropPostgresArtifactActiveStatementBarrier(persistence);
    }

    const stableRepository = makePostgresArtifactRepository(persistence);
    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "created",
      artifact,
    });
    expect(await countArtifactRows(persistence, artifact)).toBe(1);
  });
}

async function expectPostgresArtifactRecoveryDeadline(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const artifact = await captureArtifact({
      lineageId: "catalog-recovery-work-deadline",
    });
    const prepared = prepareAdmissionOrThrow(artifact);
    const observedPool = observePostgresControlPool(persistence);
    const lifecycleEvents: string[] = [];
    const transactionClients: PoolClient[] = [];
    const transactionBackendPids: number[] = [];
    const initialSettlementCause = new Error(
      "Injected pre-COMMIT recovery deadline fault.",
    );
    let initialClient: PoolClient | undefined;
    let faulted = false;
    try {
      await withPostgresArtifactAdvisoryBlocker(
        persistence,
        async (blockerPid) => {
          await installPostgresArtifactRecoveryDeadlineBarrier(
            persistence,
            blockerPid,
            artifact,
          );
          const repository = makePostgresArtifactRepository(persistence, {
            controlPool: observedPool.controlPool,
            controlSessionOptions: {
              lifecycleFault: ({ phase, edge, client }) => {
                lifecycleEvents.push(`${phase}:${edge}`);
                if (phase === "begin" && edge === "before") {
                  initialClient ??= client;
                  transactionClients.push(client);
                  transactionBackendPids.push(
                    observedPool.backendPidFor(client),
                  );
                }
                if (
                  !faulted &&
                  client === initialClient &&
                  phase === "commit" &&
                  edge === "before"
                ) {
                  faulted = true;
                  throw initialSettlementCause;
                }
              },
            },
            timeoutPolicy: {
              readTimeoutMilliseconds: 60_000,
              attemptTimeoutMilliseconds: 60_000,
              recoveryTimeoutMilliseconds: 30_000,
              lockTimeoutMilliseconds: 30_000,
            },
          });
          const observed = await expireEffectAfterGateWithObservation(
            admitFrameworkSchemaArtifactEffect(repository, prepared),
            () => waitForPostgresBackendBlockedBy(persistence, blockerPid),
            30_000,
          );
          expect(faulted).toBe(true);
          expect(transactionClients).toHaveLength(2);
          expect(new Set(transactionClients).size).toBe(2);
          expect(transactionBackendPids).toHaveLength(2);
          expect(new Set(transactionBackendPids).size).toBe(2);
          expect(observed.observation.waiterPid).toBe(
            transactionBackendPids[1],
          );
          expect(observed.observation.query.toLowerCase()).toContain(
            ARTIFACT_TABLE,
          );

          const failure = expectSingleFrameworkArtifactFailure(observed.exit);
          expect(failure).toMatchObject({
            operation: "admit",
            reason: "decisionUncertain",
            retryable: false,
            identity: artifact.identity,
            stage: "recover",
          });
          expect(Object.hasOwn(failure, "cause")).toBe(false);
          const preservedInitialCause = failure.initialSettlementCause;
          expect(Cause.isCause(preservedInitialCause)).toBe(true);
          if (!Cause.isCause(preservedInitialCause)) {
            throw new Error("Expected an initial settlement Cause.");
          }
          const initialIssues = preservedInitialCause.reasons.filter(
            Cause.isFailReason,
          ).map(reason => reason.error).filter(
            (issue): issue is
              FrameworkSchemaArtifactControlSessionResourceIssue =>
              issue instanceof
                FrameworkSchemaArtifactControlSessionResourceIssue,
          );
          expect(initialIssues).toHaveLength(1);
          expect(initialIssues[0]?.phase).toBe("commit");
          expect(initialIssues[0]?.cause).toBe(initialSettlementCause);
          const resolutionCause = failure.resolutionCause;
          expect(Cause.isCause(resolutionCause)).toBe(true);
          if (!Cause.isCause(resolutionCause)) {
            throw new Error("Expected a recovery resolution Cause.");
          }
          const recoveryIssues = resolutionCause.reasons.filter(
            Cause.isFailReason,
          ).map(reason => reason.error).filter(
            (issue): issue is
              FrameworkSchemaArtifactControlSessionResourceIssue =>
              issue instanceof
                FrameworkSchemaArtifactControlSessionResourceIssue,
          );
          expect(recoveryIssues).toHaveLength(1);
          const recoveryIssue = recoveryIssues[0];
          if (recoveryIssue === undefined) {
            throw new Error("Expected one recovery resource issue.");
          }
          expect(recoveryIssue.phase).toBe("callback");
          expect(recoveryIssue.cause).toBeInstanceOf(
            FrameworkSchemaArtifactControlSessionDeadlineIssue,
          );
          expect(recoveryIssue.cause).toMatchObject({
            deadlineKind: "recovery",
            phase: "callback",
          });
          expect(lifecycleEvents.filter(event => event === "begin:before"))
            .toHaveLength(2);
          expect(lifecycleEvents.filter(event =>
            event === "quarantine:before"
          )).toHaveLength(2);
          expect(lifecycleEvents.filter(event =>
            event === "quarantine:after"
          )).toHaveLength(2);
          const immediateActivity = await persistence.query<{
            pid: number;
            state: string;
            waitEventType: string | null;
            waitEvent: string | null;
          }>(`
            select pid::int as pid,
                   state,
                   wait_event_type as "waitEventType",
                   wait_event as "waitEvent"
            from pg_stat_activity
            where pid = any($1::int[])
            order by pid
          `, [transactionBackendPids]);
          expect({
            transactionBackendPids,
            removedBackendPids: observedPool.removedBackendPids(),
            activity: immediateActivity.rows,
          }).toEqual({
            transactionBackendPids,
            removedBackendPids: transactionBackendPids,
            activity: [],
          });
          for (const backendPid of transactionBackendPids) {
            await waitForDiscardedPostgresBackend(
              persistence,
              observedPool,
              backendPid,
            );
          }
          expect([...observedPool.removedBackendPids()].sort((left, right) =>
            left - right
          )).toEqual([...transactionBackendPids].sort((left, right) =>
            left - right
          ));
          expect(await countArtifactRows(persistence, artifact)).toBe(0);
          expect(await countDependencyRows(persistence, artifact)).toBe(0);
        },
      );
    } finally {
      observedPool.close();
      await dropPostgresArtifactRecoveryDeadlineBarrier(persistence);
    }

    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "created",
      artifact,
    });
    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "existing",
      artifact,
    });
    expect(await countArtifactRows(persistence, artifact)).toBe(1);
  });
}

async function expectPostgresArtifactOptimisticReconstructionDeadline():
  Promise<void>
{
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const artifact = await captureArtifact({
      lineageId: "catalog-optimistic-reconstruction-deadline",
    });
    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "created",
      artifact,
    });
    const prepared = prepareAdmissionOrThrow(artifact);
    const inspector = await persistence.pool.connect();
    const observedPool = observePostgresControlPool(persistence);
    const lifecycleEvents: string[] = [];
    const readBackendPids: number[] = [];
    const hashStarted = makePromiseGate();
    let digestCalls = 0;
    vi.stubGlobal("crypto", cryptoHangingAtDigest(() => {
      digestCalls += 1;
      hashStarted.open();
    }));
    try {
      const repository = makePostgresArtifactRepository(persistence, {
        controlPool: observedPool.controlPool,
        controlSessionOptions: {
          lifecycleFault: ({ phase, edge, client }) => {
            lifecycleEvents.push(`${phase}:${edge}`);
            if (phase === "configureReadBudget" && edge === "before") {
              readBackendPids.push(observedPool.backendPidFor(client));
            }
          },
        },
        timeoutPolicy: {
          readTimeoutMilliseconds: 30_000,
          attemptTimeoutMilliseconds: 30_000,
          recoveryTimeoutMilliseconds: 30_000,
          lockTimeoutMilliseconds: 30_000,
        },
      });
      const observed = await expireEffectAfterGateWithObservation(
        admitFrameworkSchemaArtifactEffect(repository, prepared),
        async () => {
          await hashStarted.promise;
          expect(lifecycleEvents.slice(-2)).toEqual([
            "release:before",
            "release:after",
          ]);
          const backendPid = readBackendPids[0];
          if (backendPid === undefined) {
            throw new Error("Expected an optimistic read backend PID.");
          }
          await waitForPostgresBackendIdle(inspector, backendPid);
          return backendPid;
        },
        30_000,
      );
      const failure = expectSingleFrameworkArtifactFailure(observed.exit);
      expect(failure).toMatchObject({
        operation: "admit",
        reason: "resourceFailure",
        retryable: false,
        identity: artifact.identity,
        stage: "reconstructArtifact",
      });
      expect(failure.cause).toBeInstanceOf(
        FrameworkSchemaArtifactControlSessionDeadlineIssue,
      );
      expect(failure.cause).toMatchObject({
        deadlineKind: "initial",
        phase: "read",
      });
      expect(digestCalls).toBe(1);
      expect(readBackendPids).toHaveLength(2);
      expect(new Set(readBackendPids).size).toBe(1);
      expect(observedPool.removedBackendPids()).toEqual([]);
      await waitForPostgresBackendIdle(
        inspector,
        observed.observation,
      );
      expect(await countArtifactRows(persistence, artifact)).toBe(1);
      expect(await countDependencyRows(persistence, artifact)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      observedPool.close();
      inspector.release();
    }

    expect(await admitArtifact(stableRepository, artifact)).toEqual({
      status: "existing",
      artifact,
    });
    expect(await countArtifactRows(persistence, artifact)).toBe(1);
  });
}

async function expectPostgresArtifactPostResolutionReconstructionDeadline():
  Promise<void>
{
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const winner = await captureArtifact({
      lineageId: "catalog-post-resolution-reconstruction-deadline",
      payload: { modules: ["winner"] },
    });
    const winnerEvidence = requireCapturedEvidence(winner);
    vi.stubGlobal(
      "crypto",
      cryptoReturning(winnerEvidence.artifactSha256Bytes),
    );
    const loser = await captureArtifact({
      lineageId: "catalog-post-resolution-reconstruction-deadline",
      payload: { modules: ["loser"] },
    });
    vi.unstubAllGlobals();
    expect(loser.identity).toEqual(winner.identity);
    expect(loser.canonicalJson).not.toBe(winner.canonicalJson);
    const preparedWinner = prepareAdmissionOrThrow(winner);
    const preparedLoser = prepareAdmissionOrThrow(loser);
    const inspector = await persistence.pool.connect();
    const observedPool = observePostgresControlPool(persistence);
    const lifecycleEvents: string[] = [];
    const readBackendPids: number[] = [];
    const transactionBackendPids: number[] = [];
    const hashStarted = makePromiseGate();
    let digestCalls = 0;
    let winnerAdmission:
      ReturnType<typeof admitPreparedArtifact> | undefined;
    let loserExit:
      Promise<Exit.Exit<unknown, FrameworkSchemaArtifactError>> | undefined;
    vi.stubGlobal("crypto", cryptoHangingAtDigest(() => {
      digestCalls += 1;
      hashStarted.open();
    }));
    try {
      const loserRepository = makePostgresArtifactRepository(persistence, {
        controlPool: observedPool.controlPool,
        controlSessionOptions: {
          lifecycleFault: ({ phase, edge, client }) => {
            lifecycleEvents.push(`${phase}:${edge}`);
            if (phase === "configureReadBudget" && edge === "before") {
              readBackendPids.push(observedPool.backendPidFor(client));
            }
            if (phase === "begin" && edge === "before") {
              transactionBackendPids.push(
                observedPool.backendPidFor(client),
              );
            }
          },
        },
        timeoutPolicy: {
          readTimeoutMilliseconds: 30_000,
          attemptTimeoutMilliseconds: 30_000,
          recoveryTimeoutMilliseconds: 30_000,
          lockTimeoutMilliseconds: 30_000,
        },
      });
      await runWithBlockedDeploymentLock(
        persistence,
        winner.identity.deploymentId,
        1,
        track => {
          winnerAdmission = track(admitPreparedArtifact(
            stableRepository,
            preparedWinner,
          ));
        },
        async (lock, firstWaiters, track) => {
          loserExit = track(expireEffectAfterGateWithObservation(
            admitFrameworkSchemaArtifactEffect(
              loserRepository,
              preparedLoser,
            ),
            async () => {
              await hashStarted.promise;
              const backendPid = readBackendPids.at(-1);
              if (backendPid === undefined) {
                throw new Error(
                  "Expected a post-resolution read backend PID.",
                );
              }
              await waitForPostgresBackendIdle(inspector, backendPid);
              return backendPid;
            },
            30_000,
          ).then(observed => observed.exit));
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
      if (winnerAdmission === undefined || loserExit === undefined) {
        throw new Error("Expected both collision admissions to start.");
      }
      expect(await winnerAdmission).toEqual({
        status: "created",
        artifact: winner,
      });
      const exit = await loserExit;
      const failure = expectSingleFrameworkArtifactFailure(exit);
      expect(failure).toMatchObject({
        operation: "admit",
        reason: "resourceFailure",
        retryable: false,
        identity: loser.identity,
        stage: "reconstructArtifact",
      });
      expectControlSessionDeadlineCause(
        failure,
        "read",
        "initial",
        "read",
      );
      expect(digestCalls).toBe(1);
      expect(readBackendPids).toHaveLength(4);
      expect(readBackendPids[0]).toBe(readBackendPids[1]);
      expect(readBackendPids[2]).toBe(readBackendPids[3]);
      expect(transactionBackendPids).toHaveLength(1);
      expect(lifecycleEvents.filter(event => event === "begin:before"))
        .toHaveLength(1);
      expect(lifecycleEvents.filter(event => event === "commit:before"))
        .toHaveLength(1);
      expect(lifecycleEvents.filter(event => event === "quarantine:before"))
        .toHaveLength(1);
      expect(lifecycleEvents.filter(event => event === "quarantine:after"))
        .toHaveLength(1);
      const postResolutionBackendPid = readBackendPids[2];
      if (postResolutionBackendPid === undefined) {
        throw new Error("Expected the post-resolution backend PID.");
      }
      await waitForDiscardedPostgresBackend(
        persistence,
        observedPool,
        postResolutionBackendPid,
      );
      expect(observedPool.removedBackendPids()).toEqual([
        postResolutionBackendPid,
      ]);
      expect(await countArtifactRows(persistence, winner)).toBe(1);
      expect(await countDependencyRows(persistence, winner)).toBe(0);
      const stored = await readStoredArtifactCanonicalBytes(
        persistence,
        winner,
      );
      expect(stored).toBe(Buffer.from(
        winnerEvidence.canonicalBytes,
      ).toString("hex"));
    } finally {
      vi.unstubAllGlobals();
      observedPool.close();
      inspector.release();
    }

    const loserOutcome = await admitPreparedArtifactResult(
      stableRepository,
      preparedLoser,
    );
    expect(Result.isFailure(loserOutcome)).toBe(true);
    if (Result.isSuccess(loserOutcome)) {
      throw new Error("Expected the post-resolution loser to collide.");
    }
    expect(loserOutcome.failure).toMatchObject({
      operation: "admit",
      reason: "digestCollision",
      retryable: false,
      identity: loser.identity,
    });
    expect(await admitPreparedArtifact(
      stableRepository,
      preparedWinner,
    )).toEqual({ status: "existing", artifact: winner });
    expect(await countArtifactRows(persistence, winner)).toBe(1);
  });
}

async function runEffectUnderFrozenClockAfterGate<Value, Failure, Observation>(
  effect: Effect.Effect<Value, Failure, never>,
  observe: () => Promise<Observation>,
): Promise<Readonly<{
  exit: Exit.Exit<Value, Failure>;
  observation: Observation;
}>> {
  return runEffect(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    const observation = yield* Effect.promise(observe);
    const exit = yield* Fiber.await(fiber);
    return Object.freeze({ exit, observation });
  }).pipe(Effect.provide(TestClock.layer())));
}

async function expireEffectAfterGate<Value, Failure>(
  effect: Effect.Effect<Value, Failure, never>,
  waitForGate: () => Promise<unknown>,
  timeoutMilliseconds: number,
): Promise<Exit.Exit<Value, Failure>> {
  const observed = await expireEffectAfterGateWithObservation(
    effect,
    waitForGate,
    timeoutMilliseconds,
  );
  return observed.exit;
}

async function expireEffectAfterGateWithObservation<
  Value,
  Failure,
  Observation,
>(
  effect: Effect.Effect<Value, Failure, never>,
  observe: () => Promise<Observation>,
  timeoutMilliseconds: number,
): Promise<Readonly<{
  exit: Exit.Exit<Value, Failure>;
  observation: Observation;
}>> {
  return runEffect(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    const observation = yield* Effect.promise(observe);
    yield* TestClock.adjust(timeoutMilliseconds);
    const exit = yield* Fiber.await(fiber);
    return Object.freeze({ exit, observation });
  }).pipe(Effect.provide(TestClock.layer())));
}

function expectSingleFrameworkArtifactFailure(
  exit: Exit.Exit<unknown, FrameworkSchemaArtifactError>,
): FrameworkSchemaArtifactError {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected framework schema artifact admission to fail.");
  }
  expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
  expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(0);
  const failures = exit.cause.reasons.filter(Cause.isFailReason).map(
    reason => reason.error,
  ).filter((failure): failure is FrameworkSchemaArtifactError =>
    failure instanceof FrameworkSchemaArtifactError
  );
  expect(failures).toHaveLength(1);
  const failure = failures[0];
  if (failure === undefined) {
    throw new Error("Expected one typed framework artifact failure.");
  }
  return failure;
}

function expectControlSessionDeadlineCause(
  failure: FrameworkSchemaArtifactError,
  resourcePhase: FrameworkSchemaArtifactControlSessionPhase,
  deadlineKind: FrameworkSchemaArtifactControlDeadlineKind,
  deadlinePhase: FrameworkSchemaArtifactControlSessionPhase,
): void {
  expect(failure.cause).toBeInstanceOf(
    FrameworkSchemaArtifactControlSessionResourceIssue,
  );
  if (
    !(failure.cause instanceof
      FrameworkSchemaArtifactControlSessionResourceIssue)
  ) {
    throw new Error("Expected a control-session resource issue.");
  }
  expect(failure.cause.phase).toBe(resourcePhase);
  expect(failure.cause.cause).toBeInstanceOf(
    FrameworkSchemaArtifactControlSessionDeadlineIssue,
  );
  expect(failure.cause.cause).toMatchObject({
    deadlineKind,
    phase: deadlinePhase,
  });
}

function expectPostgresSqlStateFailure(
  failure: FrameworkSchemaArtifactError,
  artifact: FrameworkSchemaArtifact,
  stage: "lockDeployment" | "insertDependencies",
  sqlState: "55P03" | "57014",
): void {
  expect(failure).toMatchObject({
    operation: "admit",
    reason: "resourceFailure",
    retryable: false,
    identity: artifact.identity,
    stage,
  });
  if (!isNonArrayRecord(failure.cause)) {
    throw new Error("Expected a native PostgreSQL statement failure.");
  }
  expect(postgresCode(failure.cause)).toBe(sqlState);
}

function postgresCode(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  while (
    current !== null &&
    typeof current === "object" &&
    !seen.has(current)
  ) {
    seen.add(current);
    if (!isNonArrayRecord(current)) return undefined;
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

async function makeDedicatedPostgresControlPool(
  persistence: PostgresFlarexPersistence,
  maximumConnections: number,
): Promise<Pool> {
  if (postgresUrl === null) {
    throw new Error("PostgreSQL acceptance URL is unavailable.");
  }
  const schema = await persistence.query<{ schemaName: string }>(`
    select current_schema() as "schemaName"
  `);
  const schemaName = schema.rows[0]?.schemaName;
  if (
    typeof schemaName !== "string" ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)
  ) {
    throw new Error("PostgreSQL acceptance schema name is invalid.");
  }
  return new Pool({
    connectionString: postgresUrl,
    max: maximumConnections,
    options: `-c search_path=${schemaName}`,
  });
}

async function waitForPostgresPoolWaiter(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (pool.waitingCount === 1) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for a queued PostgreSQL pool checkout.");
}

async function waitForPostgresSleepingStatement(
  persistence: PostgresFlarexPersistence,
  expectedTable: string,
): Promise<BlockedPostgresBackend> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      waiterPid: number;
      query: string;
    }>(`
      select activity.pid::int as "waiterPid",
             activity.query
      from pg_stat_activity as activity
      where activity.datname = current_database()
        and activity.state = 'active'
        and activity.wait_event_type = 'Timeout'
        and activity.wait_event = 'PgSleep'
        and activity.query ilike $1
      order by activity.pid
    `, [`%${expectedTable}%`]);
    const row = result.rows[0];
    if (
      isNonArrayRecord(row) &&
      typeof row.waiterPid === "number" &&
      Number.isSafeInteger(row.waiterPid) &&
      row.waiterPid > 0 &&
      typeof row.query === "string"
    ) {
      return Object.freeze({
        waiterPid: row.waiterPid,
        query: row.query,
      });
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for PostgreSQL pg_sleep evidence.");
}

async function installPostgresArtifactStatementTimeoutBarrier(
  persistence: PostgresFlarexPersistence,
  parent: FrameworkSchemaArtifact,
): Promise<void> {
  await persistence.query(`
    create function fx_test_framework_artifact_statement_budget()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.lineage_id = ${postgresTextLiteral(parent.identity.lineageId)} then
        perform set_config('statement_timeout', '2s', true);
      end if;
      return new;
    end
    $function$;

    create trigger fx_test_framework_artifact_statement_budget
    before insert on ${ARTIFACT_TABLE}
    for each row execute function
      fx_test_framework_artifact_statement_budget();

    create function fx_test_framework_dependency_statement_sleep()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.artifact_lineage_id =
        ${postgresTextLiteral(parent.identity.lineageId)}
      then
        perform pg_sleep(10);
      end if;
      return new;
    end
    $function$;

    create trigger fx_test_framework_dependency_statement_sleep
    before insert on ${DEPENDENCY_TABLE}
    for each row execute function
      fx_test_framework_dependency_statement_sleep();
  `);
}

async function dropPostgresArtifactStatementTimeoutBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger if exists
      fx_test_framework_dependency_statement_sleep
      on ${DEPENDENCY_TABLE};
    drop function if exists
      fx_test_framework_dependency_statement_sleep();
    drop trigger if exists
      fx_test_framework_artifact_statement_budget
      on ${ARTIFACT_TABLE};
    drop function if exists
      fx_test_framework_artifact_statement_budget();
  `);
}

async function installPostgresArtifactActiveStatementBarrier(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  artifact: FrameworkSchemaArtifact,
): Promise<void> {
  await persistence.query(`
    create function fx_test_framework_artifact_deadline_barrier()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.lineage_id = ${postgresTextLiteral(artifact.identity.lineageId)}
      then
        perform pg_advisory_xact_lock(
          ${ARTIFACT_INTERRUPT_ADVISORY_CLASS_ID},
          ${blockerPid}
        );
      end if;
      return new;
    end
    $function$;

    create trigger fx_test_framework_artifact_deadline_barrier
    before insert on ${ARTIFACT_TABLE}
    for each row execute function
      fx_test_framework_artifact_deadline_barrier();
  `);
}

async function dropPostgresArtifactActiveStatementBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger if exists
      fx_test_framework_artifact_deadline_barrier
      on ${ARTIFACT_TABLE};
    drop function if exists
      fx_test_framework_artifact_deadline_barrier();
  `);
}

async function installPostgresArtifactRecoveryDeadlineBarrier(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  artifact: FrameworkSchemaArtifact,
): Promise<void> {
  await persistence.query(`
    create sequence fx_test_framework_artifact_recovery_deadline_seq;

    create function fx_test_framework_artifact_recovery_deadline_barrier()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.lineage_id = ${postgresTextLiteral(artifact.identity.lineageId)}
        and nextval(
          'fx_test_framework_artifact_recovery_deadline_seq'
        ) >= 2
      then
        perform pg_advisory_xact_lock(
          ${ARTIFACT_INTERRUPT_ADVISORY_CLASS_ID},
          ${blockerPid}
        );
      end if;
      return new;
    end
    $function$;

    create trigger fx_test_framework_artifact_recovery_deadline_barrier
    before insert on ${ARTIFACT_TABLE}
    for each row execute function
      fx_test_framework_artifact_recovery_deadline_barrier();
  `);
}

async function dropPostgresArtifactRecoveryDeadlineBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger if exists
      fx_test_framework_artifact_recovery_deadline_barrier
      on ${ARTIFACT_TABLE};
    drop function if exists
      fx_test_framework_artifact_recovery_deadline_barrier();
    drop sequence if exists
      fx_test_framework_artifact_recovery_deadline_seq;
  `);
}

interface PromiseGate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function makePromiseGate(): PromiseGate {
  let openGate: (() => void) | undefined;
  let opened = false;
  const promise = new Promise<void>(resolve => {
    openGate = resolve;
  });
  return Object.freeze({
    promise,
    open: () => {
      if (opened) return;
      opened = true;
      openGate?.();
    },
  });
}

function cryptoHangingAtDigest(onDigest: () => void): object {
  return Object.freeze({
    subtle: Object.freeze({
      digest(): Promise<ArrayBuffer> {
        onDigest();
        return new Promise<ArrayBuffer>(() => undefined);
      },
    }),
  });
}

async function waitForPostgresBackendIdle(
  inspector: PoolClient,
  backendPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await inspector.query<{ state: string }>(`
      select state
      from pg_stat_activity
      where pid = $1
    `, [backendPid]);
    if (result.rows[0]?.state === "idle") return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for PostgreSQL backend ${backendPid} to become idle.`,
  );
}

async function readStoredArtifactCanonicalBytes(
  persistence: PostgresFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<string> {
  const result = await persistence.query<{ canonicalBytesHex: string }>(`
    select encode(canonical_bytes, 'hex') as "canonicalBytesHex"
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
  const canonicalBytesHex = result.rows[0]?.canonicalBytesHex;
  if (typeof canonicalBytesHex !== "string") {
    throw new Error("Expected one stored framework artifact byte frame.");
  }
  return canonicalBytesHex;
}

type CommitSettlementRecoveryScenario =
  typeof COMMIT_SETTLEMENT_RECOVERY_SCENARIOS[number];

async function expectPostgresCommitSettlementRecovery(
  scenario: CommitSettlementRecoveryScenario,
): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const dependency = await captureArtifact({
      lineageId: `catalog-settlement-${scenario.faultEdge}-dependency`,
    });
    expect((await admitArtifact(stableRepository, dependency)).status)
      .toBe("created");
    const parent = await captureArtifact({
      lineageId: `catalog-settlement-${scenario.faultEdge}-parent`,
      dependencies: [dependency.identity],
    });
    const observedPool = observePostgresControlPool(persistence);
    const transactionClients: PoolClient[] = [];
    const transactionBackendPids: number[] = [];
    let faulted = false;
    try {
      const faultedRepository = makePostgresArtifactRepository(
        persistence,
        {
          controlPool: observedPool.controlPool,
          controlSessionOptions: {
            lifecycleFault: ({ phase, edge, client }) => {
              if (phase === "begin" && edge === "before") {
                transactionClients.push(client);
                transactionBackendPids.push(
                  observedPool.backendPidFor(client),
                );
              }
              if (
                !faulted &&
                phase === "commit" &&
                edge === scenario.faultEdge
              ) {
                faulted = true;
                throw new Error(
                  `Injected ${scenario.faultEdge}-COMMIT settlement fault.`,
                );
              }
            },
          },
        },
      );

      expect(await admitArtifact(faultedRepository, parent)).toEqual({
        status: scenario.expectedStatus,
        artifact: parent,
      });
      expect(faulted).toBe(true);
      expect(transactionClients).toHaveLength(2);
      expect(new Set(transactionClients).size).toBe(2);
      expect(transactionBackendPids).toHaveLength(2);
      expect(new Set(transactionBackendPids).size).toBe(2);
      const initialBackendPid = transactionBackendPids[0];
      if (initialBackendPid === undefined) {
        throw new Error("Expected an initial PostgreSQL backend PID.");
      }
      await waitForDiscardedPostgresBackend(
        persistence,
        observedPool,
        initialBackendPid,
      );
      expect(observedPool.removedBackendPids()).toEqual([
        initialBackendPid,
      ]);
      expect(await countArtifactRows(persistence, dependency)).toBe(1);
      expect(await countArtifactRows(persistence, parent)).toBe(1);
      expect(await countDependencyRows(persistence, parent)).toBe(1);
      expect(await countAllDependencyRows(persistence)).toBe(1);

      expect(await admitArtifact(stableRepository, parent)).toEqual({
        status: "existing",
        artifact: parent,
      });
      expect(await countArtifactRows(persistence, parent)).toBe(1);
      expect(await countDependencyRows(persistence, parent)).toBe(1);
      expect(await countAllDependencyRows(persistence)).toBe(1);
    } finally {
      observedPool.close();
    }
  });
}

async function expectPostgresCallbackInterruption(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const dependency = await captureArtifact({
      lineageId: "catalog-callback-interruption-dependency",
    });
    expect((await admitArtifact(stableRepository, dependency)).status)
      .toBe("created");
    const parent = await captureArtifact({
      lineageId: "catalog-callback-interruption-parent",
      dependencies: [dependency.identity],
    });
    const preparedParent = prepareAdmissionOrThrow(parent);
    const observedPool = observePostgresControlPool(persistence);
    const transactionClients: PoolClient[] = [];
    const transactionBackendPids: number[] = [];
    const lifecycleEvents: string[] = [];
    const interruptedRepository = makePostgresArtifactRepository(
      persistence,
      {
        controlPool: observedPool.controlPool,
        controlSessionOptions: {
          lifecycleFault: ({ phase, edge, client }) => {
            lifecycleEvents.push(`${phase}:${edge}`);
            if (phase === "begin" && edge === "before") {
              transactionClients.push(client);
              transactionBackendPids.push(
                observedPool.backendPidFor(client),
              );
            }
          },
        },
      },
    );

    try {
      await withPostgresArtifactAdvisoryBlocker(
        persistence,
        async (blockerPid, releaseBlocker) => {
          await installPostgresCallbackInterruptionBarrier(
            persistence,
            blockerPid,
          );
          const interrupted = await interruptAdmissionWhileBlocked({
            effect: admitFrameworkSchemaArtifactEffect(
              interruptedRepository,
              preparedParent,
            ),
            waitForBlocked: () => waitForPostgresBackendBlockedBy(
              persistence,
              blockerPid,
            ),
            releaseBlocker,
            expectedQuery: query => query.toLowerCase().includes(
              DEPENDENCY_TABLE,
            ),
            expectedQueryDescription: "dependency-edge insert",
          });
          expect(interrupted.blockedBefore.waiterPid).toBe(
            transactionBackendPids[0],
          );
          expect(interrupted.blockedAfter.waiterPid).toBe(
            transactionBackendPids[0],
          );
          expectSingleInterruptExit(interrupted.exit);
        },
      );

      expect(transactionClients).toHaveLength(1);
      expect(transactionBackendPids).toHaveLength(1);
      expect(lifecycleEvents.filter(event => event === "begin:before"))
        .toHaveLength(1);
      expect(lifecycleEvents.some(event => event.startsWith("commit:")))
        .toBe(false);
      expect(lifecycleEvents.some(event => event.startsWith("quarantine:")))
        .toBe(false);
      expect(lifecycleEvents.slice(-4)).toEqual([
        "rollback:before",
        "rollback:after",
        "release:before",
        "release:after",
      ]);
      expect(observedPool.removedBackendPids()).toEqual([]);
      expect(await countArtifactRows(persistence, dependency)).toBe(1);
      expect(await countArtifactRows(persistence, parent)).toBe(0);
      expect(await countDependencyRows(persistence, parent)).toBe(0);
      expect(await countAllDependencyRows(persistence)).toBe(0);

      expect(await admitArtifact(stableRepository, parent)).toEqual({
        status: "created",
        artifact: parent,
      });
      expect(await countArtifactRows(persistence, dependency)).toBe(1);
      expect(await countArtifactRows(persistence, parent)).toBe(1);
      expect(await countDependencyRows(persistence, parent)).toBe(1);
      expect(await countAllDependencyRows(persistence)).toBe(1);
      expect(await admitArtifact(stableRepository, parent)).toEqual({
        status: "existing",
        artifact: parent,
      });
    } finally {
      observedPool.close();
      await dropPostgresCallbackInterruptionBarrier(persistence);
    }
  });
}

async function expectPostgresCommitInterruptionRecovery(): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await expectPostgres18OrdinaryRole(persistence);
    await insertDeployment(persistence);
    const stableRepository = makePostgresArtifactRepository(persistence);
    const dependency = await captureArtifact({
      lineageId: "catalog-commit-interruption-dependency",
    });
    expect((await admitArtifact(stableRepository, dependency)).status)
      .toBe("created");
    const parent = await captureArtifact({
      lineageId: "catalog-commit-interruption-parent",
      dependencies: [dependency.identity],
    });
    const preparedParent = prepareAdmissionOrThrow(parent);
    const observedPool = observePostgresControlPool(persistence);
    const transactionClients: PoolClient[] = [];
    const transactionBackendPids: number[] = [];
    const lifecycleEvents: string[] = [];
    let initialClient: PoolClient | undefined;
    let faulted = false;
    const interruptedRepository = makePostgresArtifactRepository(
      persistence,
      {
        controlPool: observedPool.controlPool,
        controlSessionOptions: {
          lifecycleFault: ({ phase, edge, client }) => {
            lifecycleEvents.push(`${phase}:${edge}`);
            if (phase === "begin" && edge === "before") {
              initialClient ??= client;
              transactionClients.push(client);
              transactionBackendPids.push(
                observedPool.backendPidFor(client),
              );
            }
            if (
              !faulted &&
              client === initialClient &&
              phase === "commit" &&
              edge === "after"
            ) {
              faulted = true;
              throw new Error(
                "Injected post-COMMIT acknowledgement fault during interruption.",
              );
            }
          },
        },
      },
    );

    try {
      await withPostgresArtifactAdvisoryBlocker(
        persistence,
        async (blockerPid, releaseBlocker) => {
          await installPostgresCommitInterruptionBarrier(
            persistence,
            blockerPid,
            parent.identity.lineageId,
          );
          const interrupted = await interruptAdmissionWhileBlocked({
            effect: admitFrameworkSchemaArtifactEffect(
              interruptedRepository,
              preparedParent,
            ),
            waitForBlocked: () => waitForPostgresBackendBlockedBy(
              persistence,
              blockerPid,
            ),
            releaseBlocker,
            expectedQuery: query => query.trim().toLowerCase() === "commit",
            expectedQueryDescription: "native COMMIT",
          });
          expect(interrupted.blockedBefore.waiterPid).toBe(
            transactionBackendPids[0],
          );
          expect(interrupted.blockedAfter.waiterPid).toBe(
            transactionBackendPids[0],
          );
          expectSingleInterruptExit(interrupted.exit);
        },
      );

      expect(faulted).toBe(true);
      expect(transactionClients).toHaveLength(2);
      expect(new Set(transactionClients).size).toBe(2);
      expect(transactionBackendPids).toHaveLength(2);
      expect(new Set(transactionBackendPids).size).toBe(2);
      expect(lifecycleEvents.filter(event => event === "begin:before"))
        .toHaveLength(2);
      expect(lifecycleEvents.filter(event => event === "commit:before"))
        .toHaveLength(2);
      expect(lifecycleEvents.filter(event => event === "commit:after"))
        .toHaveLength(2);
      expect(lifecycleEvents.filter(event => event === "quarantine:before"))
        .toHaveLength(1);
      expect(lifecycleEvents.filter(event => event === "quarantine:after"))
        .toHaveLength(1);
      expect(lifecycleEvents.slice(-2)).toEqual([
        "release:before",
        "release:after",
      ]);
      const initialBackendPid = transactionBackendPids[0];
      if (initialBackendPid === undefined) {
        throw new Error("Expected an interrupted PostgreSQL COMMIT backend PID.");
      }
      await waitForDiscardedPostgresBackend(
        persistence,
        observedPool,
        initialBackendPid,
      );
      expect(observedPool.removedBackendPids()).toEqual([
        initialBackendPid,
      ]);
      expect(await countArtifactRows(persistence, dependency)).toBe(1);
      expect(await countArtifactRows(persistence, parent)).toBe(1);
      expect(await countDependencyRows(persistence, parent)).toBe(1);
      expect(await countAllDependencyRows(persistence)).toBe(1);

      expect(await admitArtifact(stableRepository, parent)).toEqual({
        status: "existing",
        artifact: parent,
      });
      expect(await countArtifactRows(persistence, parent)).toBe(1);
      expect(await countDependencyRows(persistence, parent)).toBe(1);
      expect(await countAllDependencyRows(persistence)).toBe(1);
    } finally {
      observedPool.close();
      await dropPostgresCommitInterruptionBarrier(persistence);
    }
  });
}

interface BlockedPostgresBackend {
  readonly waiterPid: number;
  readonly query: string;
}

interface InterruptedBlockedAdmission<Value, Failure> {
  readonly exit: Exit.Exit<Value, Failure>;
  readonly blockedBefore: BlockedPostgresBackend;
  readonly blockedAfter: BlockedPostgresBackend;
}

async function interruptAdmissionWhileBlocked<Value, Failure>(
  input: Readonly<{
    readonly effect: Effect.Effect<Value, Failure, never>;
    readonly waitForBlocked: () => Promise<BlockedPostgresBackend>;
    readonly releaseBlocker: () => Promise<void>;
    readonly expectedQuery: (query: string) => boolean;
    readonly expectedQueryDescription: string;
  }>,
): Promise<InterruptedBlockedAdmission<Value, Failure>> {
  const controller = new AbortController();
  const exitPromise = Effect.runPromiseExit(input.effect, {
    signal: controller.signal,
  });
  let settled = false;
  void exitPromise.then(() => {
    settled = true;
  });
  let blockedBefore: BlockedPostgresBackend | undefined;
  let blockedAfter: BlockedPostgresBackend | undefined;
  let coordinationCause: unknown;
  let releaseCause: unknown;
  try {
    blockedBefore = await input.waitForBlocked();
    if (!input.expectedQuery(blockedBefore.query)) {
      throw new Error(
        `Expected blocked PostgreSQL ${input.expectedQueryDescription}, got ${blockedBefore.query}.`,
      );
    }
    controller.abort();
    await delay(0);
    blockedAfter = await input.waitForBlocked();
    if (!input.expectedQuery(blockedAfter.query)) {
      throw new Error(
        `Expected PostgreSQL ${input.expectedQueryDescription} to remain blocked after interruption.`,
      );
    }
    expect(blockedAfter.waiterPid).toBe(blockedBefore.waiterPid);
    expect(settled).toBe(false);
  } catch (cause) {
    coordinationCause = cause;
    controller.abort();
  } finally {
    releaseCause = await input.releaseBlocker().then(
      () => undefined,
      cause => cause,
    );
  }
  const exit = await exitPromise;
  if (coordinationCause !== undefined) throw coordinationCause;
  if (releaseCause !== undefined) throw releaseCause;
  if (blockedBefore === undefined || blockedAfter === undefined) {
    throw new Error("Expected two PostgreSQL blocked-backend observations.");
  }
  return Object.freeze({ exit, blockedBefore, blockedAfter });
}

function expectSingleInterruptExit(
  exit: Exit.Exit<unknown, unknown>,
): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected PostgreSQL artifact admission interruption.");
  }
  expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(1);
  expect(exit.cause.reasons.filter(Cause.isFailReason)).toHaveLength(0);
  expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
}

async function withPostgresArtifactAdvisoryBlocker(
  persistence: PostgresFlarexPersistence,
  operation: (
    blockerPid: number,
    releaseBlocker: () => Promise<void>,
  ) => Promise<void>,
  advisoryClassId: number = ARTIFACT_INTERRUPT_ADVISORY_CLASS_ID,
): Promise<void> {
  const blocker = await persistence.pool.connect();
  let primaryFailure: CapturedTestFailure | undefined;
  let transactionOpen = false;
  let released = false;
  const releaseBlocker = async (): Promise<void> => {
    if (released) return;
    const causes: unknown[] = [];
    let destroy = false;
    try {
      if (transactionOpen) await blocker.query("rollback");
    } catch (cause) {
      destroy = true;
      causes.push(cause);
    } finally {
      transactionOpen = false;
      try {
        blocker.release(destroy);
      } catch (cause) {
        causes.push(cause);
      }
      released = true;
    }
    if (causes.length > 0) {
      throw new AggregateError(
        causes,
        "Failed to release PostgreSQL artifact advisory blocker.",
      );
    }
  };
  try {
    const blockerPid = await readPostgresBackendPid(blocker);
    await blocker.query("begin");
    transactionOpen = true;
    await blocker.query(
      "select pg_advisory_xact_lock($1::integer, $2::integer)",
      [advisoryClassId, blockerPid],
    );
    await operation(blockerPid, releaseBlocker);
  } catch (cause) {
    primaryFailure = { cause };
  }
  const cleanupFailure = await captureTestFailure(releaseBlocker());
  if (primaryFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure.cause, cleanupFailure.cause],
      "PostgreSQL artifact advisory operation and cleanup both failed.",
    );
  }
  if (primaryFailure !== undefined) throw primaryFailure.cause;
  if (cleanupFailure !== undefined) throw cleanupFailure.cause;
}

async function readPostgresBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ backendPid: number }>(`
    select pg_backend_pid()::int as "backendPid"
  `);
  const row = result.rows[0];
  if (
    !isNonArrayRecord(row) ||
    typeof row.backendPid !== "number" ||
    !Number.isSafeInteger(row.backendPid) ||
    row.backendPid <= 0
  ) {
    throw new Error("PostgreSQL interruption blocker returned no backend PID.");
  }
  return row.backendPid;
}

async function waitForPostgresBackendBlockedBy(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<BlockedPostgresBackend> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      waiterPid: number;
      query: string;
    }>(`
      select activity.pid::int as "waiterPid",
             activity.query
      from pg_stat_activity as activity
      where activity.datname = current_database()
        and activity.state = 'active'
        and activity.wait_event_type = 'Lock'
        and activity.wait_event = 'advisory'
        and $1::int = any(pg_blocking_pids(activity.pid))
      order by activity.pid
    `, [blockerPid]);
    const row = result.rows[0];
    if (
      isNonArrayRecord(row) &&
      typeof row.waiterPid === "number" &&
      Number.isSafeInteger(row.waiterPid) &&
      row.waiterPid > 0 &&
      typeof row.query === "string"
    ) {
      return Object.freeze({
        waiterPid: row.waiterPid,
        query: row.query,
      });
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for a PostgreSQL backend blocked by ${blockerPid}.`,
  );
}

async function waitForPostgresDeploymentLockWaiterBlockedBy(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<BlockedPostgresDeploymentLockWaiter> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      waiterPid: number;
      blockerPids: number[];
    }>(`
      select activity.pid::int as "waiterPid",
             pg_blocking_pids(activity.pid) as "blockerPids"
      from pg_stat_activity as activity
      where activity.datname = current_database()
        and activity.state = 'active'
        and activity.wait_event_type = 'Lock'
        and activity.query ilike '%deployments%'
        and activity.query ilike '%for update%'
        and $1::int = any(pg_blocking_pids(activity.pid))
      order by activity.pid
    `, [blockerPid]);
    const row = result.rows[0];
    if (
      isNonArrayRecord(row) &&
      typeof row.waiterPid === "number" &&
      Number.isSafeInteger(row.waiterPid) &&
      row.waiterPid > 0 &&
      Array.isArray(row.blockerPids) &&
      row.blockerPids.every(pid =>
        typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0
      )
    ) {
      return Object.freeze({
        waiterPid: row.waiterPid,
        blockerPids: Object.freeze([...row.blockerPids]),
      });
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for a deployment lock behind backend ${blockerPid}.`,
  );
}

async function installPostgresSupportedLockOrderBarrier(
  persistence: PostgresFlarexPersistence,
  holder: "application" | "framework",
  blockerPid: number,
  frameworkArtifact: FrameworkSchemaArtifact,
  applicationArtifact: PreparedSchemaVersionArtifact,
): Promise<void> {
  if (holder === "framework") {
    await persistence.query(`
      create function fx_test_supported_lock_order_barrier()
      returns trigger
      language plpgsql
      as $function$
      begin
        if new.deployment_id = ${postgresTextLiteral(
          frameworkArtifact.identity.deploymentId,
        )}
          and new.lineage_id = ${postgresTextLiteral(
            frameworkArtifact.identity.lineageId,
          )}
        then
          perform pg_advisory_xact_lock(
            ${ARTIFACT_DEADLOCK_ADVISORY_CLASS_ID},
            ${blockerPid}
          );
        end if;
        return new;
      end
      $function$;

      create trigger fx_test_supported_lock_order_barrier
      before insert on ${ARTIFACT_TABLE}
      for each row execute function
        fx_test_supported_lock_order_barrier();
    `);
    return;
  }

  await persistence.query(`
    create function fx_test_supported_lock_order_barrier()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.deployment_id = ${postgresTextLiteral(
        applicationArtifact.deploymentId,
      )}
        and new.schema_version_id = ${postgresTextLiteral(
          applicationArtifact.schemaVersionId,
        )}
      then
        perform pg_advisory_xact_lock(
          ${ARTIFACT_DEADLOCK_ADVISORY_CLASS_ID},
          ${blockerPid}
        );
      end if;
      return new;
    end
    $function$;

    create trigger fx_test_supported_lock_order_barrier
    before insert on fx_control_schema_version
    for each row execute function
      fx_test_supported_lock_order_barrier();
  `);
}

async function dropPostgresSupportedLockOrderBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger if exists
      fx_test_supported_lock_order_barrier
      on ${ARTIFACT_TABLE};
    drop trigger if exists
      fx_test_supported_lock_order_barrier
      on fx_control_schema_version;
    drop function if exists fx_test_supported_lock_order_barrier();
  `);
}

async function installPostgresCallbackInterruptionBarrier(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<void> {
  await persistence.query(`
    create function fx_test_framework_artifact_callback_barrier()
    returns trigger
    language plpgsql
    as $function$
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
          'parent artifact was not visible before interruption barrier';
      end if;
      perform pg_advisory_xact_lock(
        ${ARTIFACT_INTERRUPT_ADVISORY_CLASS_ID},
        ${blockerPid}
      );
      return new;
    end
    $function$;

    create trigger fx_test_framework_artifact_callback_barrier
    before insert on ${DEPENDENCY_TABLE}
    for each row execute function
      fx_test_framework_artifact_callback_barrier();
  `);
}

async function dropPostgresCallbackInterruptionBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger if exists
      fx_test_framework_artifact_callback_barrier
      on ${DEPENDENCY_TABLE};
    drop function if exists
      fx_test_framework_artifact_callback_barrier();
  `);
}

async function installPostgresCommitInterruptionBarrier(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  lineageId: string,
): Promise<void> {
  await persistence.query(`
    create function fx_test_framework_artifact_commit_barrier()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_advisory_xact_lock(
        ${ARTIFACT_INTERRUPT_ADVISORY_CLASS_ID},
        ${blockerPid}
      );
      return new;
    end
    $function$;

    create constraint trigger fx_test_framework_artifact_commit_barrier
    after insert on ${ARTIFACT_TABLE}
    deferrable initially deferred
    for each row
    when (new.lineage_id = ${postgresTextLiteral(lineageId)})
    execute function fx_test_framework_artifact_commit_barrier();
  `);
}

async function dropPostgresCommitInterruptionBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger if exists
      fx_test_framework_artifact_commit_barrier
      on ${ARTIFACT_TABLE};
    drop function if exists
      fx_test_framework_artifact_commit_barrier();
  `);
}

function postgresTextLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

interface ObservedPostgresControlPool {
  readonly controlPool: PostgresArtifactControlPool;
  readonly backendPidFor: (client: PoolClient) => number;
  readonly removedBackendPids: () => readonly number[];
  readonly close: () => void;
}

function observePostgresControlPool(
  persistence: PostgresFlarexPersistence,
  pool: Pool = persistence.pool,
): ObservedPostgresControlPool {
  const backendPids = new WeakMap<PoolClient, number>();
  const removedBackendPids: number[] = [];
  const observeRemoval = (client: PoolClient) => {
    const backendPid = backendPids.get(client);
    if (backendPid !== undefined) removedBackendPids.push(backendPid);
  };
  pool.on("remove", observeRemoval);
  const controlPool: PostgresArtifactControlPool = Object.freeze({
    options: pool.options,
    connect(callback: PostgresArtifactControlPoolConnect) {
      pool.connect((error, client, release) => {
        if (error !== undefined || client === undefined) {
          callback(
            error ?? new Error("PostgreSQL control pool returned no client."),
            undefined,
            release,
          );
          return;
        }
        void client.query<{ backendPid: number }>(`
          select pg_backend_pid()::int as "backendPid"
        `).then(
          result => {
            const row = result.rows[0];
            if (
              !isNonArrayRecord(row) ||
              typeof row.backendPid !== "number" ||
              !Number.isSafeInteger(row.backendPid) ||
              row.backendPid <= 0
            ) {
              client.release(true);
              callback(
                new Error("PostgreSQL control pool returned no backend PID."),
                undefined,
                release,
              );
              return;
            }
            backendPids.set(client, row.backendPid);
            callback(undefined, client, release);
          },
          cause => {
            client.release(true);
            callback(
              cause instanceof Error
                ? cause
                : new Error("PostgreSQL backend PID probe failed.", {
                  cause,
                }),
              undefined,
              release,
            );
          },
        );
      });
    },
  });
  return Object.freeze({
    controlPool,
    backendPidFor: (client: PoolClient) => {
      const backendPid = backendPids.get(client);
      if (backendPid === undefined) {
        throw new Error("PostgreSQL control client has no observed backend PID.");
      }
      return backendPid;
    },
    removedBackendPids: () => Object.freeze([...removedBackendPids]),
    close: () => pool.off("remove", observeRemoval),
  });
}

async function waitForDiscardedPostgresBackend(
  persistence: PostgresFlarexPersistence,
  observedPool: ObservedPostgresControlPool,
  backendPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const activity = await persistence.query<{ active: boolean }>(`
      select exists (
        select 1 from pg_stat_activity where pid = $1
      ) as active
    `, [backendPid]);
    if (
      activity.rows[0]?.active === false &&
      observedPool.removedBackendPids().includes(backendPid)
    ) {
      return;
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for PostgreSQL backend ${backendPid} to be discarded.`,
  );
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

function ensureApplicationSchemaVersionArtifact(
  persistence: PostgresFlarexPersistence,
  artifact: PreparedSchemaVersionArtifact,
) {
  return persistence.drizzle.transaction(transaction => runEffect(
    ensureSchemaVersionArtifactInTransactionEffect(
      transaction,
      artifact,
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

async function countApplicationSchemaVersionRows(
  persistence: PostgresFlarexPersistence,
  artifact: PreparedSchemaVersionArtifact,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(`
    select count(*)::int as count
    from fx_control_schema_version
    where deployment_id = $1
      and schema_version_id = $2
      and version = $3
  `, [artifact.deploymentId, artifact.schemaVersionId, artifact.version]);
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
