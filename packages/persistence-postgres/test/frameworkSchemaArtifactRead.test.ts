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

import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import {
  FrameworkSchemaArtifactControlSessionResourceIssue,
  makeFrameworkSchemaArtifactControlSessionStarter,
  type FrameworkSchemaArtifactControlSessionDriver,
} from "../src/frameworkSchema/artifact/controlSession";
import {
  FrameworkSchemaArtifactError,
} from "../src/frameworkSchema/artifact/errors";
import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactCaptureInput,
  FrameworkSchemaArtifactIdentity,
} from "../src/frameworkSchema/artifact/model";
import { decodeFrameworkSchemaArtifactIdentityResult } from
  "../src/frameworkSchema/artifact/policy";
import { getFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/read";
import {
  makeFrameworkSchemaArtifactRepository,
  prepareFrameworkSchemaArtifactAdmission,
  runFrameworkSchemaArtifactRepositoryReadEffect,
  type FrameworkSchemaArtifactRepository,
} from "../src/frameworkSchema/artifact/repository";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";

const DEFAULT_READ_TIMEOUT_MILLISECONDS = 5_000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private framework schema artifact point read", () => {
  it("has the exact private Effect contract and no package export", async () => {
    expectTypeOf<ReturnType<
      typeof getFrameworkSchemaArtifactEffect
    >>().toEqualTypeOf<Effect.Effect<
      FrameworkSchemaArtifact | null,
      FrameworkSchemaArtifactError,
      never
    >>();

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const exportTargets = Object.values(packageJson.default.exports);
    expect(exportTargets).not.toContain(
      "./src/frameworkSchema/artifact/read.ts",
    );
    expect(exportTargets).not.toContain(
      "./src/frameworkSchema/artifact/storedLoader.ts",
    );
  });

  it("authenticates the repository before identity access or session work", async () => {
    const identity = (await captureArtifact()).identity;
    let identityPropertyReads = 0;
    const observedIdentity = new Proxy(identity, {
      get(target, property, receiver) {
        identityPropertyReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        identityPropertyReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        identityPropertyReads += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        identityPropertyReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const forgedRepository = Object.freeze({}) as
      FrameworkSchemaArtifactRepository;

    const exit = await Effect.runPromiseExit(
      getFrameworkSchemaArtifactEffect(
        forgedRepository,
        observedIdentity,
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        _tag: "FrameworkSchemaArtifactRepositoryInvariantDefect",
        reason: "invalidRepository",
      });
    }
    expect(identityPropertyReads).toBe(0);
  });

  it("rejects a malformed identity before acquiring a read session", async () => {
    let sessionRuns = 0;
    const controlDb = inertDatabase();
    const repository = makeReadRepository(controlDb, {
      onSessionRun: () => {
        sessionRuns += 1;
      },
    });
    const invalidIdentity = Object.freeze({
      deploymentId: "deployment-main",
      owner: "payload",
      lineageId: "lineage-main",
      artifactSha256: "A".repeat(64),
    });

    const invalidRead = Reflect.apply(
      getFrameworkSchemaArtifactEffect,
      undefined,
      [repository, invalidIdentity],
    ) as Effect.Effect<unknown, FrameworkSchemaArtifactError, never>;
    const error = await runEffectFailure(invalidRead);
    expect(error).toMatchObject({
      _tag: "FrameworkSchemaArtifactError",
      operation: "read",
      reason: "invalidInput",
      message: "Framework schema artifact identity is invalid",
      retryable: false,
    });
    expect(Object.hasOwn(error, "identity")).toBe(false);
    expect(Object.hasOwn(error, "storedStage")).toBe(false);
    expect(Object.hasOwn(error, "stage")).toBe(false);
    expect(Object.hasOwn(error, "cause")).toBe(false);
    expect(sessionRuns).toBe(0);
  });

  it("captures exact identity data without invoking accessors and owns digest bytes", async () => {
    const identity = (await captureArtifact()).identity;
    const nullPrototypeIdentity = Object.assign(Object.create(null), identity);
    const decoded = decodeFrameworkSchemaArtifactIdentityResult(
      nullPrototypeIdentity,
    );
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.identity).toEqual(identity);
      expect(decoded.success.identity).not.toBe(identity);
      expect(Object.isFrozen(decoded.success.identity)).toBe(true);
      const firstBytes = decoded.success.artifactSha256Bytes;
      const expectedBytes = new Uint8Array(
        Buffer.from(identity.artifactSha256, "hex"),
      );
      expect(firstBytes).toEqual(expectedBytes);
      firstBytes.fill(0);
      expect(decoded.success.artifactSha256Bytes).toEqual(expectedBytes);
    }

    let getterRuns = 0;
    const accessorIdentity = {
      deploymentId: identity.deploymentId,
      owner: identity.owner,
      lineageId: identity.lineageId,
      get artifactSha256() {
        getterRuns += 1;
        return identity.artifactSha256;
      },
    };
    expect(Result.isFailure(
      decodeFrameworkSchemaArtifactIdentityResult(accessorIdentity),
    )).toBe(true);
    expect(getterRuns).toBe(0);
  });

  it("preserves a complete control-session resource issue at the active stage", async () => {
    const foreignCause = new Error("acquisition failed");
    const cleanupCause = new Error("quarantine failed");
    const issue = new FrameworkSchemaArtifactControlSessionResourceIssue({
      phase: "acquire",
      cause: foreignCause,
      cleanupCause,
    });
    const controlDb = inertDatabase();
    const repository = makeReadRepository(controlDb, {
      readFailure: issue,
    });
    const identity = (await captureArtifact()).identity;

    const error = await runEffectFailure(
      getFrameworkSchemaArtifactEffect(repository, identity),
    );
    expect(error).toMatchObject({
      operation: "read",
      reason: "resourceFailure",
      message: "Framework schema artifact read failed",
      retryable: false,
      stage: "readArtifact",
      identity,
    });
    expect(error.identity).not.toBe(identity);
    expect(Object.isFrozen(error.identity)).toBe(true);
    expect(error.cause).toBe(issue);
  });

  it("returns absence and reconstructs a dependency-bearing authentic artifact only after release", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const firstDependency = await captureArtifact({
        lineageId: "lineage-dependency-a",
        payload: { tables: ["authors"] },
      });
      const secondDependency = await captureArtifact({
        lineageId: "lineage-dependency-b",
        payload: { tables: ["tags"] },
      });
      const dependencyStorageIds = new Map<string, string>();
      dependencyStorageIds.set(
        firstDependency.identity.artifactSha256,
        await insertCapturedArtifact(persistence, firstDependency, []),
      );
      dependencyStorageIds.set(
        secondDependency.identity.artifactSha256,
        await insertCapturedArtifact(persistence, secondDependency, []),
      );
      const artifact = await captureArtifact({
        dependencies: [
          secondDependency.identity,
          firstDependency.identity,
        ],
      });
      await insertCapturedArtifact(
        persistence,
        artifact,
        artifact.dependencies.map(dependency =>
          requireStorageId(dependencyStorageIds, dependency)
        ),
      );
      const missing = await captureArtifact({
        lineageId: "lineage-absent",
      });
      const events: string[] = [];
      const repository = makeReadRepository(
        pgliteControlDatabase(persistence),
        { events },
      );

      expect(await runEffect(getFrameworkSchemaArtifactEffect(
        repository,
        missing.identity,
      ))).toBeNull();
      expect(events).toEqual(["session:acquire", "session:release"]);

      events.length = 0;
      const platformDigest = globalThis.crypto.subtle.digest.bind(
        globalThis.crypto.subtle,
      );
      vi.stubGlobal("crypto", Object.freeze({
        subtle: Object.freeze({
          digest(
            algorithm: AlgorithmIdentifier,
            data: BufferSource,
          ): Promise<ArrayBuffer> {
            events.push("reconstruct:hash");
            return platformDigest(algorithm, data);
          },
        }),
      }));
      const reconstructed = await runEffect(
        getFrameworkSchemaArtifactEffect(repository, artifact.identity),
      );

      expect(events).toEqual([
        "session:acquire",
        "session:release",
        "reconstruct:hash",
      ]);
      expect(reconstructed).toEqual(artifact);
      expect(reconstructed).not.toBe(artifact);
      expect(reconstructed === null).toBe(false);
      if (reconstructed !== null) {
        expect(Result.isSuccess(
          prepareFrameworkSchemaArtifactAdmission(reconstructed),
        )).toBe(true);
        expect(Object.isFrozen(reconstructed)).toBe(true);
        expect(Object.isFrozen(reconstructed.identity)).toBe(true);
        expect(Object.isFrozen(reconstructed.dependencies)).toBe(true);
      }
    });
  }, 120_000);

  it("maps parent and dependency SQL failures to their exact active stages", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const artifact = await captureArtifact();
      await insertCapturedArtifact(persistence, artifact, []);
      const repository = makeReadRepository(
        pgliteControlDatabase(persistence),
      );

      await persistence.query(
        `drop table ${DEPENDENCY_TABLE}`,
      );
      const dependencyFailure = await runEffectFailure(
        getFrameworkSchemaArtifactEffect(repository, artifact.identity),
      );
      expect(dependencyFailure).toMatchObject({
        operation: "read",
        reason: "resourceFailure",
        stage: "readDependencies",
        identity: artifact.identity,
      });
      expect(Object.hasOwn(dependencyFailure, "storedStage")).toBe(false);
      expect(Object.hasOwn(dependencyFailure, "cause")).toBe(true);

      await persistence.query(
        `drop table ${ARTIFACT_TABLE} cascade`,
      );
      const artifactFailure = await runEffectFailure(
        getFrameworkSchemaArtifactEffect(repository, artifact.identity),
      );
      expect(artifactFailure).toMatchObject({
        operation: "read",
        reason: "resourceFailure",
        stage: "readArtifact",
        identity: artifact.identity,
      });
      expect(Object.hasOwn(artifactFailure, "storedStage")).toBe(false);
      expect(Object.hasOwn(artifactFailure, "cause")).toBe(true);
    });
  }, 120_000);

  it("projects stored corruption without relabeling it as input or resource failure", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const artifact = await captureArtifact();
      await insertCapturedArtifact(persistence, artifact, []);
      await persistence.query(`
        alter table ${ARTIFACT_TABLE}
          drop constraint fx_framework_artifact_frame_check
      `);
      await persistence.query(`
        update ${ARTIFACT_TABLE}
        set canonical_byte_length = 1,
            canonical_bytes = decode('ff', 'hex')
      `);
      const repository = makeReadRepository(
        pgliteControlDatabase(persistence),
      );

      const error = await runEffectFailure(
        getFrameworkSchemaArtifactEffect(repository, artifact.identity),
      );
      expect(error).toMatchObject({
        operation: "read",
        reason: "storedStateCorrupt",
        message: "Stored framework schema artifact state is corrupt",
        retryable: false,
        identity: artifact.identity,
        storedStage: "canonicalFrame",
      });
      expect(error.identity).not.toBe(artifact.identity);
      expect(Object.isFrozen(error.identity)).toBe(true);
      expect(Object.hasOwn(error, "stage")).toBe(false);
      expect(Object.hasOwn(error, "cause")).toBe(false);
    });
  }, 120_000);

  it("maps hashing failure and keeps the same deadline through hashing", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployment(persistence);
      const artifact = await captureArtifact();
      await insertCapturedArtifact(persistence, artifact, []);
      const events: string[] = [];
      const repository = makeReadRepository(
        pgliteControlDatabase(persistence),
        { events },
      );
      const hashCause = new Error("SHA-256 unavailable");
      vi.stubGlobal("crypto", Object.freeze({
        subtle: Object.freeze({
          digest(): Promise<ArrayBuffer> {
            events.push("reconstruct:hash");
            return Promise.reject(hashCause);
          },
        }),
      }));

      const hashError = await runEffectFailure(
        getFrameworkSchemaArtifactEffect(repository, artifact.identity),
      );
      expect(events).toEqual([
        "session:acquire",
        "session:release",
        "reconstruct:hash",
      ]);
      expect(hashError).toMatchObject({
        operation: "read",
        reason: "resourceFailure",
        stage: "reconstructArtifact",
        identity: artifact.identity,
      });
      expect(hashError.cause).toBe(hashCause);

      vi.unstubAllGlobals();
      events.length = 0;
      const deadlineRepository = makeReadRepository(
        pgliteControlDatabase(persistence),
        { events, readTimeoutMilliseconds: 100 },
      );
      vi.stubGlobal("crypto", Object.freeze({
        subtle: Object.freeze({
          digest(): Promise<ArrayBuffer> {
            events.push("reconstruct:hash");
            return new Promise<ArrayBuffer>(() => {});
          },
        }),
      }));

      const error = await runEffectFailure(
        getFrameworkSchemaArtifactEffect(
          deadlineRepository,
          artifact.identity,
        ),
      );
      expect(events).toEqual([
        "session:acquire",
        "session:release",
        "reconstruct:hash",
      ]);
      expect(error).toMatchObject({
        operation: "read",
        reason: "resourceFailure",
        stage: "reconstructArtifact",
        identity: artifact.identity,
      });
      expect(error.cause).toMatchObject({
        _tag: "FrameworkSchemaArtifactControlSessionDeadlineIssue",
        deadlineKind: "read",
        phase: "read",
      });
    });
  }, 120_000);

  it("lets an expired deadline outrank typed failure without masking defects", async () => {
    const repository = makeReadRepository(inertDatabase(), {
      readTimeoutMilliseconds: 5,
    });

    const failure = await runEffectFailure(
      runFrameworkSchemaArtifactRepositoryReadEffect<
        void,
        void,
        never,
        "reconstructionFailure"
      >(repository, {
        prepareEffect: () => Effect.succeed(undefined),
        queryAndDetachEffect: () => Effect.succeed(undefined),
        reconstructEffect: () => {
          const stopAt = performance.now() + 30;
          while (performance.now() < stopAt) {
            // Deliberately occupy the synchronous reconstruction boundary.
          }
          return Effect.fail("reconstructionFailure" as const);
        },
      }),
    );

    expect(failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactControlSessionDeadlineIssue",
      deadlineKind: "read",
      phase: "read",
    });

    const reconstructionDefect = new Error("reconstruction invariant defect");
    const defectExit = await Effect.runPromiseExit(
      runFrameworkSchemaArtifactRepositoryReadEffect(
        repository,
        {
          prepareEffect: () => Effect.succeed(undefined),
          queryAndDetachEffect: () => Effect.succeed(undefined),
          reconstructEffect: () => {
            const stopAt = performance.now() + 30;
            while (performance.now() < stopAt) {
              // Deliberately occupy the synchronous reconstruction boundary.
            }
            return Effect.die(reconstructionDefect);
          },
        },
      ),
    );
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      expect(Cause.squash(defectExit.cause)).toBe(reconstructionDefect);
    }
  });
});

interface MakeReadRepositoryOptions {
  readonly events?: string[];
  readonly onSessionRun?: () => void;
  readonly readFailure?: FrameworkSchemaArtifactControlSessionResourceIssue;
  readonly readTimeoutMilliseconds?: number;
}

function makeReadRepository(
  controlDb: FlarexMetadataDatabase,
  options: MakeReadRepositoryOptions = {},
): FrameworkSchemaArtifactRepository {
  const runReadEffect: FrameworkSchemaArtifactControlSessionDriver[
    "runReadEffect"
  ] = <Value, Failure>(
    _input: Parameters<
      FrameworkSchemaArtifactControlSessionDriver["runReadEffect"]
    >[0],
    work: (
      database: FlarexMetadataDatabase,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.suspend<
    Value,
    Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
    never
  >(() => {
    options.onSessionRun?.();
    options.events?.push("session:acquire");
    if (options.readFailure !== undefined) {
      return Effect.fail(options.readFailure);
    }
    return work(controlDb).pipe(Effect.ensuring(Effect.sync(() => {
      options.events?.push("session:release");
    })));
  });
  const driver = Object.freeze({
    runReadEffect,
    runInitialTransactionEffect: () => Effect.die(
      "Point-read fixture must not start a transaction.",
    ),
    runRecoveryTransactionEffect: () => Effect.die(
      "Point-read fixture must not start recovery.",
    ),
  } satisfies FrameworkSchemaArtifactControlSessionDriver);
  const result = makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver,
    }),
    readTimeoutMilliseconds: options.readTimeoutMilliseconds ??
      DEFAULT_READ_TIMEOUT_MILLISECONDS,
    attemptTimeoutMilliseconds: 5_000,
    recoveryTimeoutMilliseconds: 5_000,
    lockTimeoutMilliseconds: 1_000,
  });
  if (Result.isFailure(result)) {
    throw result.failure;
  }
  return result.success;
}

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

function pgliteControlDatabase(
  persistence: PGliteFlarexPersistence,
): FlarexMetadataDatabase {
  // SAFETY: both adapters expose the PgDatabase query surface used by the
  // artifact-private loader; the focused PGlite lane proves that surface.
  return persistence.drizzle as unknown as FlarexMetadataDatabase;
}

function inertDatabase(): FlarexMetadataDatabase {
  // SAFETY: authentication/failure tests never invoke a database method.
  return Object.freeze({}) as unknown as FlarexMetadataDatabase;
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
  dependencyStorageIds: readonly string[],
): Promise<string> {
  const evidence = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (evidence === undefined) {
    throw new Error("Expected authentic framework artifact evidence.");
  }
  if (dependencyStorageIds.length !== artifact.dependencies.length) {
    throw new Error("Dependency storage identities do not match artifact.");
  }
  const inserted = await persistence.query<{ storage_id: string }>(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, decode($4, 'hex'), $5, $6, $7,
      decode($8, 'hex'))
    returning artifact_storage_id::text as storage_id
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
  const artifactStorageId = inserted.rows[0]?.storage_id;
  if (artifactStorageId === undefined) {
    throw new Error("Artifact insert returned no storage identity.");
  }
  for (let ordinal = 0; ordinal < artifact.dependencies.length; ordinal += 1) {
    const dependency = artifact.dependencies[ordinal];
    const dependencyStorageId = dependencyStorageIds[ordinal];
    if (dependency === undefined || dependencyStorageId === undefined) {
      throw new Error("Artifact dependency fixture is incomplete.");
    }
    await persistence.query(`
      insert into ${DEPENDENCY_TABLE}
        (artifact_storage_id, dependency_storage_id, deployment_id, owner,
         artifact_lineage_id, dependency_ordinal, dependency_lineage_id)
      values ($1, $2, $3, $4, $5, $6, $7)
    `, [
      artifactStorageId,
      dependencyStorageId,
      artifact.identity.deploymentId,
      artifact.identity.owner,
      artifact.identity.lineageId,
      ordinal,
      dependency.lineageId,
    ]);
  }
  return artifactStorageId;
}

function requireStorageId(
  storageIds: ReadonlyMap<string, string>,
  identity: FrameworkSchemaArtifactIdentity,
): string {
  const storageId = storageIds.get(identity.artifactSha256);
  if (storageId === undefined) {
    throw new Error("Missing dependency storage identity.");
  }
  return storageId;
}
