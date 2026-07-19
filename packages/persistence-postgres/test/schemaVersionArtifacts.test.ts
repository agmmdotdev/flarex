import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestJson,
} from "flarex-protocol/schema-manifest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  EnsureSchemaVersionArtifactInput,
  FlarexPersistence,
  SchemaVersionArtifact,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactById,
  getSchemaVersionArtifactByVersion,
  InvalidPreparedSchemaVersionArtifactError,
  InvalidSchemaVersionArtifactInputError,
  prepareSchemaVersionArtifactEffect,
  type PrepareSchemaVersionArtifactError,
  type PreparedSchemaVersionArtifact,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactDeploymentNotFoundError,
  SchemaVersionArtifactPersistenceError,
  SchemaVersionArtifactPreparationError,
  type SchemaVersionArtifactTransaction,
} from "../src/schemaVersionArtifacts";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const prepareSchemaVersionArtifact = (
  ...args: Parameters<typeof prepareSchemaVersionArtifactEffect>
) => runEffect(prepareSchemaVersionArtifactEffect(...args));

const ensureSchemaVersionArtifactInTransaction = (
  ...args: Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>
) => runEffect(ensureSchemaVersionArtifactInTransactionEffect(...args));

interface CallerComputedArtifactInput {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly manifest: SchemaManifestJson;
  readonly manifestSha256: Uint8Array;
}

type CallerComputedArtifactAccepted = CallerComputedArtifactInput extends
  EnsureSchemaVersionArtifactInput
  ? true
  : false;

type PublicSchemaVersionWriter = Extract<
  keyof FlarexPersistence,
  "ensureSchemaVersionArtifact" | "insertSchemaVersionArtifact"
>;

const schemaVersionA = CatalogSchemaVersionIdSchema.make("schema_version_a");
const schemaVersionB = CatalogSchemaVersionIdSchema.make("schema_version_b");
const version1 = CatalogSchemaVersionSchema.make(1);
const version2 = CatalogSchemaVersionSchema.make(2);
const manifestA = {
  tables: [{ name: "users", fields: { name: "string", age: "number" } }],
} satisfies SchemaManifestJson;
const reorderedManifestA = {
  tables: [{ fields: { age: "number", name: "string" }, name: "users" }],
} satisfies SchemaManifestJson;
const manifestB = {
  tables: [{ name: "users", fields: { name: "string" } }],
} satisfies SchemaManifestJson;

describe("schema version artifacts", () => {
  it("keeps computed fields out of input and registration transaction-only", () => {
    expectTypeOf<CallerComputedArtifactAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PublicSchemaVersionWriter>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>[0]
      >();
    expectTypeOf<EnsureSchemaVersionArtifactInput>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>[1]
      >();
    expectTypeOf<SchemaVersionArtifact["schemaVersionId"]>()
      .toEqualTypeOf<CatalogSchemaVersionId>();
    expectTypeOf<SchemaVersionArtifact["version"]>()
      .toEqualTypeOf<CatalogSchemaVersion>();
    expectTypeOf<
      ReturnType<typeof prepareSchemaVersionArtifactEffect>
    >().toEqualTypeOf<Effect.Effect<
      PreparedSchemaVersionArtifact,
      PrepareSchemaVersionArtifactError
    >>();
  });

  it("persists one canonical artifact and replays reordered JSON exactly", async () => {
    const persistence = await migratedPGlite("canonical");
    const created = await ensure(persistence, {
      deploymentId: "deployment_schema_canonical",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const replay = await ensure(persistence, {
      deploymentId: "deployment_schema_canonical",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: reorderedManifestA,
    });

    expect(created.status).toBe("created");
    expect(created.artifact.manifestCodecVersion).toBe(1);
    expect(created.artifact.manifestSha256).toHaveLength(32);
    expect(replay).toEqual({
      status: "existing",
      artifact: created.artifact,
    });
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_canonical",
        schemaVersionA,
      ),
    ).resolves.toEqual(created.artifact);
    await expect(
      getSchemaVersionArtifactByVersion(
        persistence.drizzle,
        "deployment_schema_canonical",
        version1,
      ),
    ).resolves.toEqual(created.artifact);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_canonical",
        schemaVersionB,
      ),
    ).resolves.toBeNull();
  });

  it("rejects ID, version, and immutable-artifact reuse independently", async () => {
    const persistence = await migratedPGlite("conflict");
    await ensure(persistence, {
      deploymentId: "deployment_schema_conflict",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });

    await expect(
      ensure(persistence, {
        deploymentId: "deployment_schema_conflict",
        schemaVersionId: schemaVersionA,
        version: version2,
        manifest: manifestA,
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "schemaVersionIdReused" },
    });
    await expect(
      ensure(persistence, {
        deploymentId: "deployment_schema_conflict",
        schemaVersionId: schemaVersionB,
        version: version1,
        manifest: manifestA,
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "versionReused" },
    });
    await expect(
      ensure(persistence, {
        deploymentId: "deployment_schema_conflict",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestB,
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "artifactMismatch" },
    });

    const repeatedContent = await ensure(persistence, {
      deploymentId: "deployment_schema_conflict",
      schemaVersionId: schemaVersionB,
      version: version2,
      manifest: reorderedManifestA,
    });
    expect(repeatedContent.status).toBe("created");
  });

  it("isolates schema identities and versions by deployment", async () => {
    const persistence = await migratedPGlite("isolated_a");
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_schema_isolated_b",
      projectId: "project_schema_isolated_b",
    });
    const [left, right] = await Promise.all([
      ensure(persistence, {
        deploymentId: "deployment_schema_isolated_a",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestA,
      }),
      ensure(persistence, {
        deploymentId: "deployment_schema_isolated_b",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestB,
      }),
    ]);

    expect(left.status).toBe("created");
    expect(right.status).toBe("created");
    expect(left.artifact.manifestSha256).not.toEqual(
      right.artifact.manifestSha256,
    );
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_isolated_a",
        schemaVersionA,
      ),
    ).resolves.toEqual(left.artifact);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_isolated_b",
        schemaVersionA,
      ),
    ).resolves.toEqual(right.artifact);
  });

  it("fails closed for missing ownership, invalid manifests, and computed fields", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await expect(
      ensure(persistence, {
        deploymentId: "missing_schema_deployment",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestA,
      }),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactDeploymentNotFoundError);

    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_schema_invalid",
      projectId: "project_schema_invalid",
    });
    await expect(
      prepareSchemaVersionArtifact({
        deploymentId: "deployment_schema_invalid",
        schemaVersionId: schemaVersionA,
        version: version1,
        // @ts-expect-error Schema manifests must be JSON objects.
        manifest: [],
      }),
    ).rejects.toBeInstanceOf(InvalidSchemaVersionArtifactInputError);
    await expect(
      prepareSchemaVersionArtifact({
        deploymentId: "deployment_schema_invalid",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestA,
        // @ts-expect-error Callers cannot provide a manifest digest.
        manifestSha256: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({
      name: "InvalidSchemaVersionArtifactInputError",
      field: "manifestSha256",
    });
    const forgedPreparedArtifact = {
      deploymentId: "deployment_schema_invalid",
      schemaVersionId: schemaVersionA,
      version: version1,
    };
    const forgedFailure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(
        ensureSchemaVersionArtifactInTransactionEffect(
          tx,
          // @ts-expect-error Transactional insertion accepts only prepared tokens.
          forgedPreparedArtifact,
        ),
      )
    );
    expect(forgedFailure).toBeInstanceOf(
      InvalidPreparedSchemaVersionArtifactError,
    );
    expect(forgedFailure).toMatchObject({
      _tag: "InvalidPreparedSchemaVersionArtifactError",
    });
  });

  it("maps Web Crypto rejection at the preparation boundary", async () => {
    const rejection = new Error("schema artifact digest rejected");
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      rejection,
    );
    try {
      const failure = await runEffectFailure(
        prepareSchemaVersionArtifactEffect({
          deploymentId: "deployment_schema_prepare_failure",
          schemaVersionId: schemaVersionA,
          version: version1,
          manifest: manifestA,
        }),
      );
      expect(failure).toBeInstanceOf(SchemaVersionArtifactPreparationError);
      expect(failure).toMatchObject({
        _tag: "SchemaVersionArtifactPreparationError",
        deploymentId: "deployment_schema_prepare_failure",
        cause: rejection,
      });
    } finally {
      digest.mockRestore();
    }
  });

  it("maps SQL rejection at the owning artifact query boundary", async () => {
    const persistence = await migratedPGlite("query_failure");
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_query_failure",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    await persistence.query("drop table fx_control_schema_version cascade");

    const failure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(
        ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
      )
    );

    expect(failure).toBeInstanceOf(SchemaVersionArtifactPersistenceError);
    expect(failure).toMatchObject({
      _tag: "SchemaVersionArtifactPersistenceError",
      operation: "readById",
    });
    if (failure instanceof SchemaVersionArtifactPersistenceError) {
      expect(failure.cause).toBeInstanceOf(Error);
    }
  });

  it("preserves artifact query construction failures as defects", async () => {
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_construction_defect",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const defect = new Error("artifact deployment query construction defect");
    const tx = {
      select() {
        throw defect;
      },
    } as unknown as SchemaVersionArtifactTransaction;

    const exit = await Effect.runPromiseExit(
      ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending artifact query before interruption completes", async () => {
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_interruption",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const tx = schemaVersionArtifactSelectTransaction((selectCall) => {
      if (selectCall !== 1) {
        throw new Error(`Unexpected select call: ${selectCall}.`);
      }
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
    );

    await entered.promise;
    const completion = runEffect(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then(() => {
      interruptionSettled = true;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      query.resolve([{ deploymentId: prepared.deploymentId }]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("rolls registration back without leaving an artifact", async () => {
    const persistence = await migratedPGlite("rollback");
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_rollback",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const rolledBackArtifacts: SchemaVersionArtifact[] = [];
    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const result = await ensureSchemaVersionArtifactInTransaction(
          tx,
          prepared,
        );
        rolledBackArtifacts.push(result.artifact);
        throw new Error("injected schema artifact rollback");
      }),
    ).rejects.toThrow("injected schema artifact rollback");

    const rolledBackArtifact = rolledBackArtifacts[0];
    if (rolledBackArtifact === undefined) {
      throw new Error("Rollback test did not capture the created artifact.");
    }
    mutateFirstByte(rolledBackArtifact.manifestBytes);
    mutateFirstByte(rolledBackArtifact.manifestSha256);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_rollback",
        schemaVersionA,
      ),
    ).resolves.toBeNull();

    const retried = await persistence.drizzle.transaction((tx) =>
      ensureSchemaVersionArtifactInTransaction(tx, prepared),
    );
    expect(retried.status).toBe("created");
    mutateFirstByte(retried.artifact.manifestBytes);
    mutateFirstByte(retried.artifact.manifestSha256);
    const replayed = await persistence.drizzle.transaction((tx) =>
      ensureSchemaVersionArtifactInTransaction(tx, prepared),
    );
    expect(replayed.status).toBe("existing");
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_rollback",
        schemaVersionA,
      ),
    ).resolves.toEqual(replayed.artifact);
  });

  it("enforces physical constraints and detects stored-byte drift", async () => {
    const persistence = await migratedPGlite("constraints");
    await expect(
      persistence.query(`
        insert into fx_control_schema_version (
          deployment_id, schema_version_id, version,
          manifest_codec_version, manifest_json, manifest_bytes,
          manifest_sha256
        ) values (
          'deployment_schema_constraints', 'invalid_version', 0,
          1, '{}'::jsonb, decode('00', 'hex'),
          decode(repeat('00', 32), 'hex')
        )
      `),
    ).rejects.toThrow();
    await expect(
      persistence.query(`
        insert into fx_control_schema_version (
          deployment_id, schema_version_id, version,
          manifest_codec_version, manifest_json, manifest_bytes,
          manifest_sha256
        ) values (
          'deployment_schema_constraints', 'invalid_codec', 1,
          2, '{}'::jsonb, decode('00', 'hex'),
          decode(repeat('00', 32), 'hex')
        )
      `),
    ).rejects.toThrow();
    await expect(
      persistence.query(`
        insert into fx_control_schema_version (
          deployment_id, schema_version_id, version,
          manifest_codec_version, manifest_json, manifest_bytes,
          manifest_sha256
        ) values (
          'deployment_schema_constraints', 'invalid_manifest', 1,
          1, '[]'::jsonb, decode('00', 'hex'),
          decode(repeat('00', 32), 'hex')
        )
      `),
    ).rejects.toThrow();

    await ensure(persistence, {
      deploymentId: "deployment_schema_constraints",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    await persistence.query(`
      update fx_control_schema_version
      set manifest_bytes = decode('00', 'hex')
      where deployment_id = 'deployment_schema_constraints'
    `);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_constraints",
        schemaVersionA,
      ),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactCorruptionError);

    await ensure(persistence, {
      deploymentId: "deployment_schema_constraints",
      schemaVersionId: schemaVersionB,
      version: version2,
      manifest: manifestB,
    });
    await persistence.query(`
      update fx_control_schema_version
      set manifest_json = '{"tampered": true}'::jsonb
      where deployment_id = 'deployment_schema_constraints'
        and schema_version_id = 'schema_version_b'
    `);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_constraints",
        schemaVersionB,
      ),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactCorruptionError);
    await persistence.query(`
      update fx_control_schema_version
      set manifest_json = '{"tables":[{"name":"users","fields":{"name":"string"}}]}'::jsonb
      where deployment_id = 'deployment_schema_constraints'
        and schema_version_id = 'schema_version_b'
    `);
    await persistence.query(`
      update fx_control_schema_version
      set manifest_sha256 = decode(repeat('00', 32), 'hex')
      where deployment_id = 'deployment_schema_constraints'
        and schema_version_id = 'schema_version_b'
    `);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_constraints",
        schemaVersionB,
      ),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactCorruptionError);
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPGlite(suffix: string): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await persistence.insertDeploymentMetadata({
    deploymentId: `deployment_schema_${suffix}`,
    projectId: `project_schema_${suffix}`,
  });
  return persistence;
}

async function ensure(
  persistence: PGlitePersistence,
  input: EnsureSchemaVersionArtifactInput,
) {
  const prepared = await prepareSchemaVersionArtifact(input);
  return persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, prepared),
  );
}

function mutateFirstByte(bytes: Uint8Array): void {
  const first = bytes[0];
  if (first === undefined) {
    throw new Error("Expected a nonempty byte sequence.");
  }
  bytes[0] = first ^ 0xff;
}

interface SchemaVersionArtifactQueryStub
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): SchemaVersionArtifactQueryStub;
  where(): SchemaVersionArtifactQueryStub;
  limit(): SchemaVersionArtifactQueryStub;
  for(): SchemaVersionArtifactQueryStub;
}

function schemaVersionArtifactSelectTransaction(
  runSelect: (selectCall: number) => Promise<ReadonlyArray<unknown>>,
): SchemaVersionArtifactTransaction {
  let selectCall = 0;
  return {
    select() {
      selectCall += 1;
      const promise = runSelect(selectCall);
      const query: SchemaVersionArtifactQueryStub = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as SchemaVersionArtifactTransaction;
}

function deferredValue<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
}> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve(value: Value) {
      if (resolvePromise === undefined) {
        throw new Error("Deferred value was not initialized.");
      }
      resolvePromise(value);
    },
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
