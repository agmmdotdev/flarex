import { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  FrameworkSchemaArtifactControlSessionResourceIssue,
  makeFrameworkSchemaArtifactControlSessionStarter,
  type FrameworkSchemaArtifactControlSessionDriver,
} from "../src/frameworkSchema/artifact/controlSession";
import { FrameworkSchemaArtifactError } from
  "../src/frameworkSchema/artifact/errors";
import { listFrameworkSchemaArtifactIdentitiesEffect } from
  "../src/frameworkSchema/artifact/list";
import type {
  FrameworkSchemaArtifactIdentity,
  FrameworkSchemaArtifactIdentityPage,
  FrameworkSchemaArtifactOwner,
  ListFrameworkSchemaArtifactIdentitiesInput,
} from "../src/frameworkSchema/artifact/model";
import {
  decodeFrameworkSchemaArtifactIdentityResult,
  decodeFrameworkSchemaArtifactListInputResult,
} from "../src/frameworkSchema/artifact/policy";
import {
  makeFrameworkSchemaArtifactRepository,
  type FrameworkSchemaArtifactRepository,
} from "../src/frameworkSchema/artifact/repository";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from
  "./frameworkSchemaArtifactAdmissionTestSupport";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";

const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;

describe("private framework schema artifact identity listing", () => {
  it("has the exact private Effect contract and no package export", async () => {
    expectTypeOf<ReturnType<
      typeof listFrameworkSchemaArtifactIdentitiesEffect
    >>().toEqualTypeOf<Effect.Effect<
      FrameworkSchemaArtifactIdentityPage,
      FrameworkSchemaArtifactError,
      never
    >>();

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/artifact/list.ts",
    );
  });

  it("authenticates authority first and rejects every malformed request before acquisition", async () => {
    const validInput = makeListInput({ limit: 1 });
    let inputTrapRuns = 0;
    const observedInput = new Proxy(validInput, {
      getPrototypeOf(target) {
        inputTrapRuns += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        inputTrapRuns += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        inputTrapRuns += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const forgedRepository = Object.freeze({}) as
      FrameworkSchemaArtifactRepository;

    const forgedExit = await Effect.runPromiseExit(
      listFrameworkSchemaArtifactIdentitiesEffect(
        forgedRepository,
        observedInput,
      ),
    );
    expect(Exit.isFailure(forgedExit)).toBe(true);
    if (Exit.isFailure(forgedExit)) {
      expect(Cause.squash(forgedExit.cause)).toMatchObject({
        _tag: "FrameworkSchemaArtifactRepositoryInvariantDefect",
        reason: "invalidRepository",
      });
    }
    expect(inputTrapRuns).toBe(0);

    let accessorRuns = 0;
    const accessorInput = {
      deploymentId: "deployment-main",
      owner: "payload",
      lineageId: "lineage-main",
      afterArtifactSha256: null,
      get limit() {
        accessorRuns += 1;
        return 1;
      },
    };
    const invalidInputs: readonly unknown[] = [
      null,
      [],
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
        limit: 1,
      },
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
        afterArtifactSha256: undefined,
        limit: 1,
      },
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
        afterArtifactSha256: null,
      },
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
        afterArtifactSha256: null,
        limit: undefined,
      },
      {
        deploymentId: "deployment-main",
        owner: "application",
        lineageId: "lineage-main",
        afterArtifactSha256: null,
        limit: 1,
      },
      {
        deploymentId: " ",
        owner: "payload",
        lineageId: "lineage-main",
        afterArtifactSha256: null,
        limit: 1,
      },
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: " ",
        afterArtifactSha256: null,
        limit: 1,
      },
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
        afterArtifactSha256: "A".repeat(64),
        limit: 1,
      },
      {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
        afterArtifactSha256: "0".repeat(63),
        limit: 1,
      },
      ...[0, 101, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN,
        Number.POSITIVE_INFINITY].map(limit => ({
          deploymentId: "deployment-main",
          owner: "payload",
          lineageId: "lineage-main",
          afterArtifactSha256: null,
          limit,
        })),
      {
        ...validInput,
        extra: true,
      },
      Object.assign({ ...validInput }, { [Symbol("extra")]: true }),
      accessorInput,
      new Proxy({ ...validInput }, {
        ownKeys() {
          throw new Error("hostile ownKeys");
        },
      }),
    ];
    let sessionRuns = 0;
    const repository = makeListRepository(inertDatabase(), {
      onSessionRun: () => {
        sessionRuns += 1;
      },
    });

    for (const invalidInput of invalidInputs) {
      const error = await runEffectFailure(
        invokeListWithUnknownInput(repository, invalidInput),
      );
      expect(error).toMatchObject({
        _tag: "FrameworkSchemaArtifactError",
        operation: "list",
        reason: "invalidInput",
        message: "Framework schema artifact list input is invalid",
        retryable: false,
      });
      expect(Object.hasOwn(error, "coordinate")).toBe(false);
      expect(Object.hasOwn(error, "storedStage")).toBe(false);
      expect(Object.hasOwn(error, "stage")).toBe(false);
      expect(Object.hasOwn(error, "cause")).toBe(false);
    }
    expect(sessionRuns).toBe(0);
    expect(accessorRuns).toBe(0);
  });

  it("owns the decoded coordinate and cursor bytes without changing the spelling", () => {
    const cursor = digestForInteger(128);
    const nullPrototypeInput = Object.assign(Object.create(null), {
      deploymentId: "deployment-main",
      owner: "payload",
      lineageId: "lineage-main",
      afterArtifactSha256: cursor,
      limit: 100,
    });

    const decoded = decodeFrameworkSchemaArtifactListInputResult(
      nullPrototypeInput,
    );
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.coordinate).toEqual({
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-main",
      });
      expect(Object.isFrozen(decoded.success.coordinate)).toBe(true);
      expect(decoded.success.afterArtifactSha256).toBe(cursor);
      const expectedBytes = new Uint8Array(Buffer.from(cursor, "hex"));
      const firstBytes = decoded.success.afterArtifactSha256Bytes;
      expect(firstBytes).toEqual(expectedBytes);
      firstBytes?.fill(0);
      expect(decoded.success.afterArtifactSha256Bytes).toEqual(expectedBytes);
      expect(decoded.success.limit).toBe(100);
    }
  });

  it("projects control-session acquisition failure at the list boundary", async () => {
    const foreignCause = new Error("acquisition failed");
    const cleanupCause = new Error("quarantine failed");
    const issue = new FrameworkSchemaArtifactControlSessionResourceIssue({
      phase: "acquire",
      cause: foreignCause,
      cleanupCause,
    });
    const repository = makeListRepository(inertDatabase(), {
      readFailure: issue,
    });
    const input = makeListInput({ limit: 1 });

    const error = await runEffectFailure(
      listFrameworkSchemaArtifactIdentitiesEffect(repository, input),
    );
    expect(error).toMatchObject({
      operation: "list",
      reason: "resourceFailure",
      message: "Framework schema artifact list failed",
      retryable: false,
      coordinate: {
        deploymentId: input.deploymentId,
        owner: input.owner,
        lineageId: input.lineageId,
      },
      stage: "listArtifacts",
    });
    expect(Object.isFrozen(error.coordinate)).toBe(true);
    expect(error.cause).toBe(issue);
    expect(Object.hasOwn(error, "storedStage")).toBe(false);
  });

  it("paginates in digest-byte order with exclusive gap cursors and exact isolation", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployments(persistence);
      const orderedValues = [9, 10, 15, 16, 127, 128, 255] as const;
      for (const value of orderedValues) {
        await insertRawArtifact(persistence, {
          deploymentId: "deployment-main",
          owner: "payload",
          lineageId: "lineage-order",
          digest: digestForInteger(value),
        });
      }
      await insertRawArtifact(persistence, {
        deploymentId: "deployment-other",
        owner: "payload",
        lineageId: "lineage-order",
        digest: digestForInteger(9),
      });
      await insertRawArtifact(persistence, {
        deploymentId: "deployment-main",
        owner: "medusa",
        lineageId: "lineage-order",
        digest: digestForInteger(9),
      });
      await insertRawArtifact(persistence, {
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-other",
        digest: digestForInteger(9),
      });
      const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      );

      const empty = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          fixture.repository,
          makeListInput({ lineageId: "lineage-empty", limit: 1 }),
        ),
      );
      expect(empty).toEqual({ items: [], nextAfterArtifactSha256: null });

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: FrameworkSchemaArtifactIdentityPage = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            fixture.repository,
            makeListInput({
              lineageId: "lineage-order",
              afterArtifactSha256: cursor,
              limit: 2,
            }),
          ),
        );
        seen.push(...page.items.map(item => item.artifactSha256));
        cursor = page.nextAfterArtifactSha256;
      } while (cursor !== null);
      expect(seen).toEqual(orderedValues.map(digestForInteger));

      const gapPage = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          fixture.repository,
          makeListInput({
            lineageId: "lineage-order",
            afterArtifactSha256: digestForInteger(11),
            limit: 2,
          }),
        ),
      );
      expect(gapPage.items.map(item => item.artifactSha256)).toEqual([
        digestForInteger(15),
        digestForInteger(16),
      ]);
      expect(gapPage.nextAfterArtifactSha256).toBe(digestForInteger(16));

      const afterFinal = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          fixture.repository,
          makeListInput({
            lineageId: "lineage-order",
            afterArtifactSha256: digestForInteger(255),
            limit: 2,
          }),
        ),
      );
      expect(afterFinal).toEqual({
        items: [],
        nextAfterArtifactSha256: null,
      });

      const firstInput = makeListInput({
        lineageId: "lineage-order",
        limit: 2,
      });
      const first = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          fixture.repository,
          firstInput,
        ),
      );
      const repeated = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          fixture.repository,
          firstInput,
        ),
      );
      expect(first).toEqual(repeated);
      expect(first).not.toBe(repeated);
      expect(first.items).not.toBe(repeated.items);
      expect(first.items[0]).not.toBe(repeated.items[0]);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.items)).toBe(true);
      expect(first.items.every(Object.isFrozen)).toBe(true);
      expect(Reflect.ownKeys(first.items[0] ?? {})).toEqual([
        "deploymentId",
        "owner",
        "lineageId",
        "artifactSha256",
      ]);

      await persistence.query(`
        alter table ${ARTIFACT_TABLE} drop column canonical_bytes cascade
      `);
      await persistence.query(`drop table ${DEPENDENCY_TABLE}`);
      const identityOnly = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          fixture.repository,
          makeListInput({ lineageId: "lineage-order", limit: 100 }),
        ),
      );
      expect(identityOnly.items.map(item => item.artifactSha256)).toEqual(
        orderedValues.map(digestForInteger),
      );
      expect(identityOnly.nextAfterArtifactSha256).toBeNull();
    });
  }, 120_000);

  it("uses the last returned digest for the 100/101 lookahead boundary", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployments(persistence);
      await insertRawArtifactRange(persistence, "lineage-101", 0, 100);
      await insertRawArtifactRange(persistence, "lineage-100", 0, 99);
      const repository = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      ).repository;

      const first = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          repository,
          makeListInput({ lineageId: "lineage-101", limit: 100 }),
        ),
      );
      expect(first.items).toHaveLength(100);
      expect(first.items[0]?.artifactSha256).toBe(digestForInteger(0));
      expect(first.items.at(-1)?.artifactSha256).toBe(digestForInteger(99));
      expect(first.nextAfterArtifactSha256).toBe(digestForInteger(99));

      const second = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          repository,
          makeListInput({
            lineageId: "lineage-101",
            afterArtifactSha256: first.nextAfterArtifactSha256,
            limit: 100,
          }),
        ),
      );
      expect(second.items.map(item => item.artifactSha256)).toEqual([
        digestForInteger(100),
      ]);
      expect(second.nextAfterArtifactSha256).toBeNull();

      const exact = await runEffect(
        listFrameworkSchemaArtifactIdentitiesEffect(
          repository,
          makeListInput({ lineageId: "lineage-100", limit: 100 }),
        ),
      );
      expect(exact.items).toHaveLength(100);
      expect(exact.nextAfterArtifactSha256).toBeNull();
    });
  }, 120_000);

  it("decodes a corrupt lookahead row before slicing the page", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployments(persistence);
      await insertRawArtifact(persistence, {
        lineageId: "lineage-corrupt",
        digest: "00".repeat(32),
      });
      await insertRawArtifact(persistence, {
        lineageId: "lineage-corrupt",
        digest: "ff".repeat(32),
      });
      await persistence.query(`
        alter table ${ARTIFACT_TABLE}
          drop constraint fx_framework_artifact_identity_check
      `);
      await persistence.query(`
        update ${ARTIFACT_TABLE}
        set artifact_sha256 = decode($1, 'hex')
        where lineage_id = 'lineage-corrupt'
          and artifact_sha256 = decode($2, 'hex')
      `, ["ff".repeat(31), "ff".repeat(32)]);
      const repository = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      ).repository;
      const input = makeListInput({
        lineageId: "lineage-corrupt",
        limit: 1,
      });

      const error = await runEffectFailure(
        listFrameworkSchemaArtifactIdentitiesEffect(repository, input),
      );
      expect(error).toMatchObject({
        operation: "list",
        reason: "storedStateCorrupt",
        message: "Stored framework schema artifact state is corrupt",
        retryable: false,
        coordinate: {
          deploymentId: input.deploymentId,
          owner: input.owner,
          lineageId: input.lineageId,
        },
        storedStage: "artifactRow",
      });
      expect(Object.isFrozen(error.coordinate)).toBe(true);
      expect(Object.hasOwn(error, "stage")).toBe(false);
      expect(Object.hasOwn(error, "cause")).toBe(false);
    });
  }, 120_000);

  it("maps an artifact-table query rejection to the exact list resource stage", async () => {
    await withPGlitePersistence(async persistence => {
      await insertDeployments(persistence);
      const repository = makePGliteFrameworkSchemaArtifactAdmissionFixture(
        persistence,
      ).repository;
      await persistence.query(`drop table ${ARTIFACT_TABLE} cascade`);
      const input = makeListInput({ limit: 1 });

      const error = await runEffectFailure(
        listFrameworkSchemaArtifactIdentitiesEffect(repository, input),
      );
      expect(error).toMatchObject({
        operation: "list",
        reason: "resourceFailure",
        message: "Framework schema artifact list failed",
        retryable: false,
        coordinate: {
          deploymentId: input.deploymentId,
          owner: input.owner,
          lineageId: input.lineageId,
        },
        stage: "listArtifacts",
      });
      expect(Object.isFrozen(error.coordinate)).toBe(true);
      expect(Object.hasOwn(error, "storedStage")).toBe(false);
      expect(Object.hasOwn(error, "cause")).toBe(true);
    });
  }, 120_000);
});

interface MakeListRepositoryOptions {
  readonly onSessionRun?: () => void;
  readonly readFailure?: FrameworkSchemaArtifactControlSessionResourceIssue;
}

function makeListRepository(
  controlDb: FlarexMetadataDatabase,
  options: MakeListRepositoryOptions = {},
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
    if (options.readFailure !== undefined) {
      return Effect.fail(options.readFailure);
    }
    return work(controlDb);
  });
  const driver = Object.freeze({
    runReadEffect,
    runInitialTransactionEffect: () => Effect.die(
      "Identity-list fixture must not start a transaction.",
    ),
    runRecoveryTransactionEffect: () => Effect.die(
      "Identity-list fixture must not start recovery.",
    ),
  } satisfies FrameworkSchemaArtifactControlSessionDriver);
  const result = makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver,
    }),
    readTimeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    attemptTimeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    recoveryTimeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    lockTimeoutMilliseconds: 1_000,
  });
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function invokeListWithUnknownInput(
  repository: FrameworkSchemaArtifactRepository,
  input: unknown,
): Effect.Effect<
  FrameworkSchemaArtifactIdentityPage,
  FrameworkSchemaArtifactError,
  never
> {
  // SAFETY: this focused runtime-contract test intentionally bypasses the
  // static input type to prove that the importable private boundary decodes it.
  return Reflect.apply(
    listFrameworkSchemaArtifactIdentitiesEffect,
    undefined,
    [repository, input],
  ) as Effect.Effect<
    FrameworkSchemaArtifactIdentityPage,
    FrameworkSchemaArtifactError,
    never
  >;
}

function inertDatabase(): FlarexMetadataDatabase {
  // SAFETY: authority/input tests never invoke a database method.
  return Object.freeze({}) as FlarexMetadataDatabase;
}

function makeListInput(
  overrides: Readonly<{
    deploymentId?: string;
    owner?: FrameworkSchemaArtifactOwner;
    lineageId?: string;
    afterArtifactSha256?: string | null;
    limit: number;
  }>,
): ListFrameworkSchemaArtifactIdentitiesInput {
  const deploymentId = overrides.deploymentId ?? "deployment-main";
  const owner = overrides.owner ?? "payload";
  const lineageId = overrides.lineageId ?? "lineage-main";
  const coordinateIdentity = makeIdentity({
    deploymentId,
    owner,
    lineageId,
    digest: digestForInteger(0),
  });
  const cursorInput = overrides.afterArtifactSha256 ?? null;
  const afterArtifactSha256 = cursorInput === null
    ? null
    : makeIdentity({
      deploymentId,
      owner,
      lineageId,
      digest: cursorInput,
    }).artifactSha256;
  return Object.freeze({
    deploymentId: coordinateIdentity.deploymentId,
    owner: coordinateIdentity.owner,
    lineageId: coordinateIdentity.lineageId,
    afterArtifactSha256,
    limit: overrides.limit,
  });
}

function makeIdentity(input: Readonly<{
  deploymentId?: string;
  owner?: FrameworkSchemaArtifactOwner;
  lineageId?: string;
  digest: string;
}>): FrameworkSchemaArtifactIdentity {
  const decoded = decodeFrameworkSchemaArtifactIdentityResult({
    deploymentId: input.deploymentId ?? "deployment-main",
    owner: input.owner ?? "payload",
    lineageId: input.lineageId ?? "lineage-main",
    artifactSha256: input.digest,
  });
  if (Result.isFailure(decoded)) {
    throw new Error("Test identity must satisfy the artifact identity contract.");
  }
  return decoded.success.identity;
}

function digestForInteger(value: number): string {
  return value.toString(16).padStart(64, "0");
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

async function insertDeployments(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values
      ('deployment-main', 'project-main'),
      ('deployment-other', 'project-other')
  `);
}

async function insertRawArtifact(
  persistence: PGliteFlarexPersistence,
  input: Readonly<{
    deploymentId?: string;
    owner?: FrameworkSchemaArtifactOwner;
    lineageId: string;
    digest: string;
  }>,
): Promise<void> {
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, decode($4, 'hex'),
      'flarex.framework-schema-artifact', 1, 1, decode('ff', 'hex'))
  `, [
    input.deploymentId ?? "deployment-main",
    input.owner ?? "payload",
    input.lineageId,
    input.digest,
  ]);
}

async function insertRawArtifactRange(
  persistence: PGliteFlarexPersistence,
  lineageId: string,
  start: number,
  end: number,
): Promise<void> {
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    select 'deployment-main', 'payload', $1,
      decode(lpad(to_hex(value), 64, '0'), 'hex'),
      'flarex.framework-schema-artifact', 1, 1, decode('ff', 'hex')
    from generate_series($2::integer, $3::integer) as values(value)
  `, [lineageId, start, end]);
}
