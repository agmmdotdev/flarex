import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestJson,
} from "flarex-protocol/schema-manifest";
import { expect } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByIdEffect,
  getSchemaVersionArtifactWithOriginalByIdEffect,
  prepareSchemaVersionArtifactEffect,
} from "../src/schemaVersionArtifacts";
import { MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 } from
  "../src/storedCommitAuthorityEvidence";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

async function registerArtifact(persistence: Persistence, suffix: string) {
  const deploymentId = `deployment_original_schema_${suffix}`;
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `original_schema_${suffix}`,
  );
  const manifest = {
    tables: [{ name: "users", fields: { name: "string", age: "number" } }],
    literal: 1e-323,
    label: "မူရင်း",
  } satisfies SchemaManifestJson;
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_original_schema_${suffix}`,
  });
  const prepared = await runEffect(prepareSchemaVersionArtifactEffect({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    manifest,
  }));
  const registered = await persistence.drizzle.transaction(tx => runEffect(
    ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
  ));
  return { deploymentId, schemaVersionId, artifact: registered.artifact };
}

async function readDatabaseOriginal(persistence: Persistence,
  identity: Awaited<ReturnType<typeof registerArtifact>>) {
  const result = await persistence.query<{
    deploymentId: string;
    schemaVersionId: string;
    version: number;
    manifestCodecVersion: number;
    manifestJsonText: string;
    manifestBytes: Uint8Array;
    manifestSha256: Uint8Array;
    createdAt: Date;
    manifestJsonByteLengthText: string;
    manifestCanonicalByteLengthText: string;
  }>(`
    select deployment_id as "deploymentId", schema_version_id as "schemaVersionId",
      version, manifest_codec_version as "manifestCodecVersion",
      manifest_json::text as "manifestJsonText", manifest_bytes as "manifestBytes",
      manifest_sha256 as "manifestSha256", created_at as "createdAt",
      octet_length(manifest_json::text)::bigint::text as "manifestJsonByteLengthText",
      octet_length(manifest_bytes)::bigint::text as "manifestCanonicalByteLengthText"
    from fx_control_schema_version
    where deployment_id = $1 and schema_version_id = $2
  `, [identity.deploymentId, identity.schemaVersionId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Registered original schema row is missing.");
  return { ...row, manifestBytes: new Uint8Array(row.manifestBytes),
    manifestSha256: new Uint8Array(row.manifestSha256) };
}

export async function originalSchemaEvidenceScenario(persistence: Persistence) {
  const identity = await registerArtifact(persistence, "retention");
  const databaseOriginal = await readDatabaseOriginal(persistence, identity);
  const acquired = await runEffect(getSchemaVersionArtifactWithOriginalByIdEffect(
    persistence.drizzle, identity.deploymentId, identity.schemaVersionId,
    MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  ));
  if (acquired === null || acquired.original.payload === null)
    throw new Error("Genuine original schema evidence was not retained.");
  const { artifact, original: { sizes, payload } } = acquired;
  expect(artifact).toEqual(identity.artifact);
  const { manifestJsonByteLengthText, manifestCanonicalByteLengthText,
    manifestJsonText, manifestBytes, ...scalars } = databaseOriginal;
  expect(payload).toEqual({ ...scalars, manifestJsonText, manifestBytes });
  expect(sizes).toEqual({ ...scalars, manifestJsonByteLengthText,
    manifestCanonicalByteLengthText });
  // JSONB retains its database text projection, not authored JSON whitespace.
  expect(payload.manifestJsonText).toBe(databaseOriginal.manifestJsonText);
  expect(payload.manifestJsonText).not.toBe(JSON.stringify(artifact.manifestJson));
  expect(Number(sizes.manifestJsonByteLengthText)).toBe(
    new TextEncoder().encode(payload.manifestJsonText).byteLength,
  );
  expect(Number(sizes.manifestCanonicalByteLengthText)).toBe(payload.manifestBytes.byteLength);
  expect(Number(sizes.manifestJsonByteLengthText)).toBeGreaterThan(
    Number(sizes.manifestCanonicalByteLengthText),
  );
  expect(payload.manifestBytes).not.toBe(artifact.manifestBytes);
  expect(payload.manifestSha256).not.toBe(artifact.manifestSha256);
  expect(sizes.manifestSha256).not.toBe(payload.manifestSha256);
  expect(sizes.manifestSha256).not.toBe(artifact.manifestSha256);
  expect(payload.createdAt).not.toBe(artifact.createdAt);
  expect(sizes.createdAt).not.toBe(payload.createdAt);
  expect(sizes.createdAt).not.toBe(artifact.createdAt);

  payload.manifestBytes.fill(0);
  payload.manifestSha256.fill(0);
  payload.createdAt.setTime(0);
  expect(artifact).toEqual(identity.artifact);
  expect(sizes.manifestSha256).toEqual(databaseOriginal.manifestSha256);
  expect(sizes.createdAt).toEqual(databaseOriginal.createdAt);
  sizes.manifestSha256.fill(0);
  sizes.createdAt.setTime(0);
  const reread = await runEffect(getSchemaVersionArtifactWithOriginalByIdEffect(
    persistence.drizzle, identity.deploymentId, identity.schemaVersionId,
    MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  ));
  expect(reread?.artifact).toEqual(identity.artifact);
  expect(reread?.original.payload).toEqual({ ...scalars, manifestJsonText, manifestBytes });
  expect(reread?.original.sizes).toEqual({ ...scalars, manifestJsonByteLengthText,
    manifestCanonicalByteLengthText });
}

export async function originalSchemaWithholdingScenario(persistence: Persistence) {
  const identity = await registerArtifact(persistence, "withholding");
  const databaseOriginal = await readDatabaseOriginal(persistence, identity);
  const total = Number(databaseOriginal.manifestJsonByteLengthText) +
    Number(databaseOriginal.manifestCanonicalByteLengthText);
  const selectedRows: ReadonlyArray<Record<string, unknown>>[] = [];
  const observedDatabase = observeSelectedRows(persistence.drizzle,
    rows => selectedRows.push(rows));
  // Deliberately exercise the trusted acquisition input bound. This is not a
  // second production cap: the production caller supplies its existing limit.
  const withheld = await runEffect(getSchemaVersionArtifactWithOriginalByIdEffect(
    observedDatabase, identity.deploymentId, identity.schemaVersionId, total - 1,
  ));
  expect(withheld?.artifact).toEqual(identity.artifact);
  expect(withheld?.original.payload).toBeNull();
  expect(withheld?.original.sizes).toMatchObject({
    manifestJsonByteLengthText: databaseOriginal.manifestJsonByteLengthText,
    manifestCanonicalByteLengthText: databaseOriginal.manifestCanonicalByteLengthText,
  });
  // Observe genuine SQL results before owner decoding: the database withheld
  // JSON transport while returning the canonical bytes needed for authentication.
  expect(selectedRows[0]?.[0]).toMatchObject({
    manifestJsonText: null,
    manifestJsonByteLengthText: databaseOriginal.manifestJsonByteLengthText,
    manifestCanonicalByteLengthText: databaseOriginal.manifestCanonicalByteLengthText,
  });
  const selectedManifestBytes = selectedRows[0]?.[0]?.manifestBytes;
  if (!(selectedManifestBytes instanceof Uint8Array))
    throw new Error("Genuine SQL result did not retain semantic canonical bytes.");
  expect(new Uint8Array(selectedManifestBytes)).toEqual(identity.artifact.manifestBytes);
  const exact = await runEffect(getSchemaVersionArtifactWithOriginalByIdEffect(
    persistence.drizzle, identity.deploymentId, identity.schemaVersionId, total,
  ));
  expect(exact?.original.payload?.manifestJsonText).toBe(databaseOriginal.manifestJsonText);
  await expect(runEffect(getSchemaVersionArtifactByIdEffect(persistence.drizzle,
    identity.deploymentId, identity.schemaVersionId))).resolves.toEqual(identity.artifact);
}

export async function originalSchemaCorruptionScenario(persistence: Persistence) {
  for (const corruption of ["bytes", "digest", "json"] as const) {
    const identity = await registerArtifact(persistence, `corruption_${corruption}`);
    const update = corruption === "bytes"
      ? "manifest_bytes = decode('ff', 'hex')"
      : corruption === "digest"
        ? "manifest_sha256 = decode(repeat('00', 32), 'hex')"
        : "manifest_json = '{\"tables\":[]}'::jsonb";
    await persistence.query(`update fx_control_schema_version set ${update}
      where deployment_id = $1 and schema_version_id = $2`,
    [identity.deploymentId, identity.schemaVersionId]);
    // Withholding original transport must never bypass semantic authentication.
    for (const limit of [MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1, 1]) {
      const failure = await runEffectFailure(getSchemaVersionArtifactWithOriginalByIdEffect(
        persistence.drizzle, identity.deploymentId, identity.schemaVersionId, limit,
      ));
      expect(failure).toMatchObject({
        _tag: "SchemaVersionArtifactCorruptionError",
        deploymentId: identity.deploymentId,
        detail: corruption === "bytes" ? "canonical manifest bytes are invalid"
          : corruption === "digest" ? "stored manifest SHA-256 does not match canonical bytes"
            : "stored manifest JSON or immutable evidence changed during verification",
      });
    }
    await expect(persistence.query("select 1 as ok"))
      .resolves.toMatchObject({ rows: [{ ok: 1 }] });
  }
}

/** Observe the actual Drizzle result, preserving the database and query owner. */
function observeSelectedRows(database: FlarexMetadataDatabase,
  observe: (rows: ReadonlyArray<Record<string, unknown>>) => void): FlarexMetadataDatabase {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      return (...args: ReadonlyArray<unknown>) => new ObservedSchemaQuery(
        Reflect.apply(target.select, target, args), observe,
      );
    },
  });
}

class ObservedSchemaQuery implements PromiseLike<ReadonlyArray<Record<string, unknown>>> {
  constructor(private query: unknown,
    private readonly observe: (rows: ReadonlyArray<Record<string, unknown>>) => void) {}

  from(...args: ReadonlyArray<unknown>): this { return this.invoke("from", args); }
  where(...args: ReadonlyArray<unknown>): this { return this.invoke("where", args); }
  limit(...args: ReadonlyArray<unknown>): this { return this.invoke("limit", args); }

  private invoke(method: "from" | "where" | "limit", args: ReadonlyArray<unknown>): this {
    if (typeof this.query !== "object" || this.query === null)
      throw new Error("Expected an actual schema artifact query builder.");
    const operation = Reflect.get(this.query, method);
    if (typeof operation !== "function") throw new Error(`Schema query has no ${method}.`);
    this.query = Reflect.apply(operation, this.query, args);
    return this;
  }

  then<TResult1 = ReadonlyArray<Record<string, unknown>>, TResult2 = never>(
    onfulfilled?: ((rows: ReadonlyArray<Record<string, unknown>>) =>
      TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    // This narrow test observer wraps only Drizzle's genuine artifact SELECT.
    return Promise.resolve(this.query as PromiseLike<ReadonlyArray<Record<string, unknown>>>)
      .then(rows => { this.observe(rows); return rows; })
      .then(onfulfilled, onrejected);
  }
}
