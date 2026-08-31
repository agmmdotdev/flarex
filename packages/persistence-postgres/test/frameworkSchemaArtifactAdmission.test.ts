import { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Result } from "effect";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import { admitFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/admission";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import { FrameworkSchemaArtifactControlSessionResourceIssue } from
  "../src/frameworkSchema/artifact/controlSession";
import { FrameworkSchemaArtifactError } from
  "../src/frameworkSchema/artifact/errors";
import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactCaptureInput,
} from "../src/frameworkSchema/artifact/model";
import {
  prepareFrameworkSchemaArtifactAdmission,
  type FrameworkSchemaArtifactRepository,
  type PreparedFrameworkSchemaArtifactAdmission,
} from "../src/frameworkSchema/artifact/repository";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  makePGliteFrameworkSchemaArtifactAdmissionFixture,
} from "./frameworkSchemaArtifactAdmissionTestSupport";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private framework schema artifact admission", () => {
  it("keeps the exact private contract and authenticates authority before work", async () => {
    expectTypeOf<ReturnType<
      typeof admitFrameworkSchemaArtifactEffect
    >>().toEqualTypeOf<Effect.Effect<
      Readonly<{
        readonly status: "created" | "existing";
        readonly artifact: FrameworkSchemaArtifact;
      }>,
      FrameworkSchemaArtifactError,
      never
    >>();

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/artifact/admission.ts",
    );

    const artifact = await captureArtifact();
    const prepared = prepareOrThrow(artifact);
    let preparedReads = 0;
    const observedPrepared = new Proxy(prepared, {
      get(target, property, receiver) {
        preparedReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        preparedReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        preparedReads += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        preparedReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const forgedRepository = Object.freeze({}) as
      FrameworkSchemaArtifactRepository;
    const invalidRepositoryExit = await Effect.runPromiseExit(
      admitFrameworkSchemaArtifactEffect(
        forgedRepository,
        observedPrepared,
      ),
    );
    expect(Exit.isFailure(invalidRepositoryExit)).toBe(true);
    if (Exit.isFailure(invalidRepositoryExit)) {
      expect(Cause.squash(invalidRepositoryExit.cause)).toMatchObject({
        _tag: "FrameworkSchemaArtifactRepositoryInvariantDefect",
        reason: "invalidRepository",
      });
    }
    expect(preparedReads).toBe(0);

    await withPGlitePersistence(async persistence => {
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );
      const forgedPrepared = Object.freeze({}) as
        PreparedFrameworkSchemaArtifactAdmission;
      const error = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          forgedPrepared,
        ),
      );
      expect(error).toMatchObject({
        operation: "admit",
        reason: "invalidInput",
        message: "Framework schema artifact admission input is invalid",
        retryable: false,
      });
      expect(fixture.events).toEqual([]);
    });
  }, 120_000);

  it("creates, takes the optimistic exact-replay path, and retains lineage history", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );
      const artifact = await captureArtifact();

      const created = await admitArtifact(fixture.repository, artifact);
      expect(created).toEqual({ status: "created", artifact });
      expect(created.artifact).toBe(artifact);
      expect(Object.isFrozen(created)).toBe(true);
      expect(await countArtifacts(persistence, artifact)).toBe(1);

      const transactionCount = fixture.events.filter(event =>
        event === "initial:begin"
      ).length;
      const existing = await admitArtifact(fixture.repository, artifact);
      expect(existing.status).toBe("existing");
      expect(existing.artifact).toEqual(artifact);
      expect(fixture.events.filter(event =>
        event === "initial:begin"
      )).toHaveLength(transactionCount);
      expect(await countArtifacts(persistence, artifact)).toBe(1);

      const next = await captureArtifact({
        payload: { tables: ["posts", "authors"] },
      });
      expect(next.identity.lineageId).toBe(artifact.identity.lineageId);
      expect(next.identity.artifactSha256).not.toBe(
        artifact.identity.artifactSha256,
      );
      expect((await admitArtifact(fixture.repository, next)).status)
        .toBe("created");
      expect(await countLineageArtifacts(persistence, artifact)).toBe(2);
    });
  }, 120_000);

  it("returns exact missing-deployment and missing-dependency diagnostics without writes", async () => {
    await withPGlitePersistence(async persistence => {
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );
      const artifact = await captureArtifact();
      const deploymentError = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(artifact),
        ),
      );
      expect(deploymentError).toMatchObject({
        operation: "admit",
        reason: "deploymentMissing",
        message: "Framework schema artifact deployment is missing",
        retryable: false,
        deploymentId: artifact.identity.deploymentId,
      });
      expect(Object.hasOwn(deploymentError, "identity")).toBe(false);
      expect(Object.hasOwn(deploymentError, "cause")).toBe(false);

      await insertDeployment(persistence);
      for (const missingOrdinal of [0, 1, 2]) {
        const dependencies = await Promise.all([0, 1, 2].map(index =>
          captureArtifact({
            lineageId: `lineage-missing-${missingOrdinal}-${index}`,
            payload: { table: `dependency-${missingOrdinal}-${index}` },
          })
        ));
        for (let ordinal = 0; ordinal < dependencies.length; ordinal += 1) {
          if (ordinal !== missingOrdinal) {
            await admitArtifact(
              fixture.repository,
              requireArtifactAt(dependencies, ordinal),
            );
          }
        }
        const parent = await captureArtifact({
          lineageId: `lineage-parent-missing-${missingOrdinal}`,
          dependencies: dependencies.map(dependency => dependency.identity),
        });

        const dependencyError = await runEffectFailure(
          admitFrameworkSchemaArtifactEffect(
            fixture.repository,
            prepareOrThrow(parent),
          ),
        );
        expect(dependencyError).toMatchObject({
          operation: "admit",
          reason: "dependencyMissing",
          message: "Framework schema artifact dependency is missing",
          retryable: false,
          identity: parent.identity,
          dependencyIdentity:
            requireArtifactAt(dependencies, missingOrdinal).identity,
          dependencyOrdinal: missingOrdinal,
        });
        expect(dependencyError.identity).not.toBe(parent.identity);
        expect(dependencyError.dependencyIdentity).not.toBe(
          requireArtifactAt(dependencies, missingOrdinal).identity,
        );
        expect(Object.isFrozen(dependencyError.identity)).toBe(true);
        expect(Object.isFrozen(dependencyError.dependencyIdentity)).toBe(true);
        expect(Object.hasOwn(dependencyError, "cause")).toBe(false);
        expect(await countArtifacts(persistence, parent)).toBe(0);
      }
    });
  }, 120_000);

  it("inserts dependency edges atomically in canonical ordinal order", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );
      const dependencies = await Promise.all([0, 1, 2].map(index =>
        captureArtifact({
          lineageId: `lineage-dependency-${index}`,
          payload: { table: `dependency-${index}` },
        })
      ));
      for (const dependency of dependencies) {
        expect((await admitArtifact(fixture.repository, dependency)).status)
          .toBe("created");
      }
      const parent = await captureArtifact({
        dependencies: [
          requireArtifactAt(dependencies, 2).identity,
          requireArtifactAt(dependencies, 0).identity,
          requireArtifactAt(dependencies, 1).identity,
        ],
      });

      expect((await admitArtifact(fixture.repository, parent)).status)
        .toBe("created");
      const rows = await persistence.query<{
        ordinal: number;
        lineage_id: string;
      }>(`
        select d.dependency_ordinal as ordinal,
               target.lineage_id
        from ${DEPENDENCY_TABLE} as d
        join ${ARTIFACT_TABLE} as target
          on target.artifact_storage_id = d.dependency_storage_id
        join ${ARTIFACT_TABLE} as parent
          on parent.artifact_storage_id = d.artifact_storage_id
        where parent.artifact_sha256 = decode($1, 'hex')
        order by d.dependency_ordinal asc
      `, [parent.identity.artifactSha256]);
      expect(rows.rows).toEqual(parent.dependencies.map(
        (dependency, ordinal) => ({
          ordinal,
          lineage_id: dependency.lineageId,
        }),
      ));

      const existing = await admitArtifact(fixture.repository, parent);
      expect(existing.status).toBe("existing");
      expect(existing.artifact).toEqual(parent);
    });
  }, 120_000);

  it("admits and exactly replays the 256-dependency boundary", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const dependencies = await Promise.all(
        Array.from({ length: 256 }, (_, index) => captureArtifact({
          lineageId: `lineage-boundary-${String(index).padStart(3, "0")}`,
          payload: { table: `dependency-${index}` },
        })),
      );
      for (const dependency of dependencies) {
        await insertCapturedArtifact(persistence, dependency);
      }
      const parent = await captureArtifact({
        lineageId: "lineage-boundary-parent",
        dependencies: dependencies.map(dependency => dependency.identity),
      });
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );

      expect((await admitArtifact(fixture.repository, parent)).status)
        .toBe("created");
      const edgeCount = await persistence.query<{ count: string }>(`
        select count(*)::text as count
        from ${DEPENDENCY_TABLE} as dependency
        join ${ARTIFACT_TABLE} as parent
          on parent.artifact_storage_id = dependency.artifact_storage_id
        where parent.artifact_sha256 = decode($1, 'hex')
      `, [parent.identity.artifactSha256]);
      expect(edgeCount.rows[0]?.count).toBe("256");

      const existing = await admitArtifact(fixture.repository, parent);
      expect(existing.status).toBe("existing");
      expect(existing.artifact).toEqual(parent);
    });
  }, 120_000);

  it("classifies only fully reconstructed evidence as collision or corruption", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );
      const stored = await captureArtifact();
      const storedEvidence = requireCapturedEvidence(stored);
      await insertCapturedArtifact(persistence, stored);
      vi.stubGlobal("crypto", cryptoReturning(storedEvidence.artifactSha256Bytes));
      const colliding = await captureArtifact({
        payload: { tables: ["different-but-same-digest"] },
      });
      expect(colliding.identity).toEqual(stored.identity);

      const collision = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(colliding),
        ),
      );
      expect(collision).toMatchObject({
        operation: "admit",
        reason: "digestCollision",
        message: "Framework schema artifact digest collision",
        retryable: false,
        identity: stored.identity,
      });
      expect(collision.identity).not.toBe(stored.identity);
      expect(Object.hasOwn(collision, "cause")).toBe(false);

      vi.unstubAllGlobals();
      await persistence.query(`
        alter table ${ARTIFACT_TABLE}
          drop constraint fx_framework_artifact_frame_check
      `);
      await persistence.query(`
        update ${ARTIFACT_TABLE}
        set canonical_byte_length = 1,
            canonical_bytes = decode('ff', 'hex')
      `);
      const corruption = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(stored),
        ),
      );
      expect(corruption).toMatchObject({
        operation: "admit",
        reason: "storedStateCorrupt",
        message: "Stored framework schema artifact state is corrupt",
        retryable: false,
        identity: stored.identity,
        storedStage: "canonicalFrame",
      });
      expect(Object.hasOwn(corruption, "cause")).toBe(false);
    });
  }, 120_000);

  it("returns locked exact replay from compact evidence without hashing", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const artifact = await captureArtifact();
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
        {
          beforeInitialTransaction: () =>
            insertCapturedArtifact(persistence, artifact),
        },
      );
      const digestTransactionStates: boolean[] = [];
      vi.stubGlobal("crypto", Object.freeze({
        subtle: Object.freeze({
          digest(): Promise<ArrayBuffer> {
            digestTransactionStates.push(fixture.isTransactionActive());
            return Promise.reject(new Error("unexpected digest"));
          },
        }),
      }));

      const existing = await admitArtifact(fixture.repository, artifact);
      expect(existing).toEqual({ status: "existing", artifact });
      expect(existing.artifact).toBe(artifact);
      expect(digestTransactionStates).toEqual([]);
      expect(fixture.events).toContain("initial:commit");
      expect(await countArtifacts(persistence, artifact)).toBe(1);
    });
  }, 120_000);

  it("resolves a raced mismatch after the lock and never hashes inside the transaction", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const stored = await captureArtifact();
      const storedEvidence = requireCapturedEvidence(stored);
      vi.stubGlobal("crypto", cryptoReturning(storedEvidence.artifactSha256Bytes));
      const incoming = await captureArtifact({
        payload: { tables: ["raced-collision"] },
      });
      vi.unstubAllGlobals();

      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
        {
          beforeInitialTransaction: () =>
            insertCapturedArtifact(persistence, stored),
        },
      );
      const platformDigest = globalThis.crypto.subtle.digest.bind(
        globalThis.crypto.subtle,
      );
      const digestTransactionStates: boolean[] = [];
      vi.stubGlobal("crypto", Object.freeze({
        subtle: Object.freeze({
          digest(
            algorithm: AlgorithmIdentifier,
            data: BufferSource,
          ): Promise<ArrayBuffer> {
            digestTransactionStates.push(fixture.isTransactionActive());
            return platformDigest(algorithm, data);
          },
        }),
      }));

      const error = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(incoming),
        ),
      );
      expect(error).toMatchObject({
        operation: "admit",
        reason: "digestCollision",
      });
      expect(digestTransactionStates).toEqual([false]);
      expect(fixture.events).toContain("initial:commit");
      expect(fixture.events.filter(event => event === "read:acquire"))
        .toHaveLength(2);
    });
  }, 120_000);

  it("attributes post-settlement resolution acquisition to the read stage", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const dependency = await captureArtifact({
        lineageId: "lineage-resolution-acquire-dependency",
      });
      const parent = await captureArtifact({
        lineageId: "lineage-resolution-acquire-parent",
        dependencies: [dependency.identity],
      });
      const acquisitionCause = new Error("resolution read acquisition failed");
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
        {
          beforeInitialTransaction: () =>
            insertCapturedArtifact(persistence, parent),
          failPostSettlementReadAcquisition: { cause: acquisitionCause },
        },
      );

      const error = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(parent),
        ),
      );

      expect(error).toMatchObject({
        operation: "admit",
        reason: "resourceFailure",
        stage: "readArtifact",
      });
      expect(error.cause).toBeInstanceOf(
        FrameworkSchemaArtifactControlSessionResourceIssue,
      );
      if (
        !(error.cause instanceof
          FrameworkSchemaArtifactControlSessionResourceIssue)
      ) {
        throw new Error("Expected a control-session resource issue.");
      }
      expect(error.cause.phase).toBe("acquire");
      expect(error.cause.cause).toBe(acquisitionCause);
      expect(fixture.events).toContain("initial:commit");
      expect(fixture.events.filter(event => event === "read:acquire"))
        .toHaveLength(2);
      expect(fixture.events).toContain("read:acquireFailed");
    });
  }, 120_000);

  it("rolls back the parent when the dependency insert fails", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );
      const dependency = await captureArtifact({
        lineageId: "lineage-rollback-dependency",
      });
      await admitArtifact(fixture.repository, dependency);
      const parent = await captureArtifact({
        lineageId: "lineage-rollback-parent",
        dependencies: [dependency.identity],
      });
      await persistence.query(`drop table ${DEPENDENCY_TABLE}`);

      const error = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(parent),
        ),
      );
      expect(error).toMatchObject({
        operation: "admit",
        reason: "resourceFailure",
        message: "Framework schema artifact admission persistence failed",
        retryable: false,
        identity: parent.identity,
        stage: "insertDependencies",
      });
      expect(Object.hasOwn(error, "cause")).toBe(true);
      expect(await countArtifacts(persistence, parent)).toBe(0);
    });
  }, 120_000);

  it("projects uncertain settlement with both exact causes and no ordinary cause", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const initialSettlementCause = new Error("commit acknowledgement lost");
      const quarantineCause = new Error("session destruction failed");
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
        {
          uncertainAfterCommit: {
            initialSettlementCause,
            quarantineCause,
          },
        },
      );
      const artifact = await captureArtifact();

      const error = await runEffectFailure(
        admitFrameworkSchemaArtifactEffect(
          fixture.repository,
          prepareOrThrow(artifact),
        ),
      );
      expect(error).toMatchObject({
        operation: "admit",
        reason: "decisionUncertain",
        message: "Framework schema artifact admission decision is uncertain",
        retryable: false,
        identity: artifact.identity,
        stage: "settle",
      });
      expect(error.initialSettlementCause).toBe(initialSettlementCause);
      expect(error.resolutionCause).toBe(quarantineCause);
      expect(Object.hasOwn(error, "cause")).toBe(false);
      expect(await countArtifacts(persistence, artifact)).toBe(1);
    });
  }, 120_000);
});

async function withPGlitePersistence(
  run: (persistence: PGliteFlarexPersistence) => Promise<void>,
): Promise<void> {
  const database = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db: database });
    await persistence.migrate();
    await run(persistence);
  } finally {
    await database.close();
  }
}

async function captureArtifact(
  overrides: Partial<FrameworkSchemaArtifactCaptureInput> = {},
): Promise<FrameworkSchemaArtifact> {
  return runEffect(captureFrameworkSchemaArtifact({
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: "lineage-main",
    payloadCodec: { format: "json", version: 1 },
    provenance: { source: "compiler" },
    capabilities: [],
    dependencies: [],
    payload: { tables: ["posts"] },
    ...overrides,
  }));
}

function prepareOrThrow(
  artifact: FrameworkSchemaArtifact,
): PreparedFrameworkSchemaArtifactAdmission {
  const prepared = prepareFrameworkSchemaArtifactAdmission(artifact);
  if (Result.isFailure(prepared)) throw prepared.failure;
  return prepared.success;
}

async function admitArtifact(
  repository: FrameworkSchemaArtifactRepository,
  artifact: FrameworkSchemaArtifact,
) {
  return runEffect(admitFrameworkSchemaArtifactEffect(
    repository,
    prepareOrThrow(artifact),
  ));
}

async function insertDeployment(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values ('deployment-main', 'project-main')
  `);
}

async function insertCapturedArtifact(
  persistence: PGliteFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<void> {
  const evidence = requireCapturedEvidence(artifact);
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, decode($4, 'hex'), $5, $6, $7,
      decode($8, 'hex'))
  `, [
    artifact.identity.deploymentId,
    artifact.identity.owner,
    artifact.identity.lineageId,
    artifact.identity.artifactSha256,
    "flarex.framework-schema-artifact",
    1,
    evidence.canonicalBytes.byteLength,
    Buffer.from(evidence.canonicalBytes).toString("hex"),
  ]);
}

function requireCapturedEvidence(artifact: FrameworkSchemaArtifact) {
  const evidence = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (evidence === undefined) {
    throw new Error("Expected authentic framework artifact evidence.");
  }
  return evidence;
}

async function countArtifacts(
  persistence: PGliteFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
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
  return Number(result.rows[0]?.count ?? "0");
}

async function countLineageArtifacts(
  persistence: PGliteFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
    from ${ARTIFACT_TABLE}
    where deployment_id = $1
      and owner = $2
      and lineage_id = $3
  `, [
    artifact.identity.deploymentId,
    artifact.identity.owner,
    artifact.identity.lineageId,
  ]);
  return Number(result.rows[0]?.count ?? "0");
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

function requireArtifactAt(
  artifacts: readonly FrameworkSchemaArtifact[],
  index: number,
): FrameworkSchemaArtifact {
  const artifact = artifacts[index];
  if (artifact === undefined) {
    throw new Error(`Missing framework artifact fixture at index ${index}.`);
  }
  return artifact;
}
