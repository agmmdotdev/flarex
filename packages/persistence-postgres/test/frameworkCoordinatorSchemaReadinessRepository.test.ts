import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { asc, eq } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import {
  MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
  captureFrameworkSchemaReadiness,
} from "../src/frameworkSchema/installation/canonical";
import {
  ensureFrameworkSchemaReadinessInTransactionEffect,
  readFrameworkSchemaReadinessInTransactionEffect,
} from "../src/frameworkSchema/installation/readinessRepository";
import { fxSystemFrameworkSchemaReadiness } from
  "../src/frameworkSchema/installation/schema";
import type {
  RestoredFrameworkSchemaInstallation,
  RestoredFrameworkSchemaReadiness,
} from "../src/frameworkSchema/installation/storedMetadataRestoration";
import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulInstallationGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 120_000;
const FIRST_VALIDATED_AT = "2026-08-27T08:35:00.000Z";
const SECOND_VALIDATED_AT = "2026-08-27T08:36:00.000Z";
const VALIDATION_SHA256 = "33".repeat(32);

describe("framework coordinator schema-readiness repository", () => {
  it("keeps the readiness transaction kernel source-private", async () => {
    expect(
      "ensureFrameworkSchemaReadinessInTransactionEffect" in persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkSchemaReadinessInTransactionEffect" in persistenceRoot,
    ).toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/installation/readinessRepository.ts",
    );
  });

  it("reads absence, ensures exact normalized storage, and replays", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulInstallationGraphInTransaction(
          transaction,
          values,
        );
        const readiness = await captureReadiness(
          graph.installation,
          FIRST_VALIDATED_AT,
        );
        const missing = await runEffect(
          readFrameworkSchemaReadinessInTransactionEffect(
            transaction,
            graph.installation,
            readiness,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);
        const ensured = await runEffect(
          ensureFrameworkSchemaReadinessInTransactionEffect(
            transaction,
            graph.installation,
            readiness,
          ),
        );
        const replayed = await runEffect(
          ensureFrameworkSchemaReadinessInTransactionEffect(
            transaction,
            graph.installation,
            readiness,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkSchemaReadinessInTransactionEffect(
            transaction,
            graph.installation,
            readiness,
          ),
        ));
        expect(replayed.storageId).toBe(ensured.storageId);
        expect(read).toEqual(ensured);
        return { graph, readiness, ensured };
      },
    );

    const independentlyCaptured = await captureReadiness(
      stored.ensured.installation,
      FIRST_VALIDATED_AT,
    );
    expect(independentlyCaptured).not.toBe(stored.readiness);
    const separateReplay = await persistence.drizzle.transaction(
      transaction => runEffect(
        ensureFrameworkSchemaReadinessInTransactionEffect(
          transaction,
          stored.ensured.installation,
          independentlyCaptured,
        ),
      ),
    );
    expect(separateReplay.storageId).toBe(stored.ensured.storageId);
    await expect(readinessCount(persistence)).resolves.toBe("1");
    await expect(storedReadinessRows(persistence)).resolves.toEqual([
      expectedReadinessRow(stored.ensured),
    ]);
  }, PGLITE_TEST_TIMEOUT);

  it("preserves one receipt per installation and refuses missing parents", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedReadinessFixture(persistence);
    const conflicting = await captureReadiness(
      stored.ensured.installation,
      SECOND_VALIDATED_AT,
    );
    expect(conflicting.sha256).not.toBe(stored.readiness.sha256);
    const conflict = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkSchemaReadinessInTransactionEffect(
          transaction,
          stored.ensured.installation,
          conflicting,
        ),
      ),
    );
    expect(conflict).toMatchObject({
      operation: "ensureReadiness",
      reason: "immutableConflict",
    });
    await expect(storedReadinessRows(persistence)).resolves.toEqual([
      expectedReadinessRow(stored.ensured),
    ]);

    const emptyPersistence = await createMigratedPGlitePersistence();
    const missing = await emptyPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaReadinessInTransactionEffect(
          transaction,
          stored.ensured.installation,
          stored.readiness,
        ),
      ),
    );
    expect(missing).toMatchObject({
      operation: "readReadiness",
      reason: "referenceRefusal",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("rejects corrupt projections and canonical bytes without healing", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await storedReadinessFixture(projectionPersistence);
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkSchemaReadiness,
    ).set({ validationSha256: new Uint8Array(32).fill(0x7f) }).where(eq(
      fxSystemFrameworkSchemaReadiness.readinessStorageId,
      projection.ensured.storageId,
    ));
    const projectionBefore = await storedReadinessRows(projectionPersistence);
    await expectStoredCorruption(
      projectionPersistence,
      "ensureReadiness",
      transaction => ensureFrameworkSchemaReadinessInTransactionEffect(
        transaction,
        projection.graph.installation,
        projection.readiness,
      ),
    );
    await expect(storedReadinessRows(projectionPersistence)).resolves.toEqual(
      projectionBefore,
    );

    const corruptPersistence = await createMigratedPGlitePersistence();
    const corrupt = await storedReadinessFixture(corruptPersistence);
    const changedBytes = canonicalBytes(corrupt.readiness);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await corruptPersistence.drizzle.update(
      fxSystemFrameworkSchemaReadiness,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkSchemaReadiness.readinessStorageId,
      corrupt.ensured.storageId,
    ));
    await expectStoredCorruption(
      corruptPersistence,
      "readReadiness",
      transaction => readFrameworkSchemaReadinessInTransactionEffect(
        transaction,
        corrupt.graph.installation,
        corrupt.readiness,
      ),
    );

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await storedReadinessFixture(oversizedPersistence);
    await oversizedPersistence.query(`
      alter table fx_system_framework_schema_readiness
        drop constraint fx_framework_readiness_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkSchemaReadiness,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkSchemaReadiness.readinessStorageId,
      oversized.ensured.storageId,
    ));
    const before = await storedReadinessRows(oversizedPersistence);
    await expectStoredCorruption(
      oversizedPersistence,
      "ensureReadiness",
      transaction => ensureFrameworkSchemaReadinessInTransactionEffect(
        transaction,
        oversized.graph.installation,
        oversized.readiness,
      ),
    );
    await expect(storedReadinessRows(oversizedPersistence)).resolves.toEqual(
      before,
    );
  }, 180_000);

  it("follows caller rollback and preserves the exact driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const prepared = await persistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulInstallationGraphInTransaction(
          transaction,
          values,
        );
        const readiness = await captureReadiness(
          graph.installation,
          FIRST_VALIDATED_AT,
        );
        return { graph, readiness };
      },
    );
    const rollback = new Error("deliberate readiness rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(ensureFrameworkSchemaReadinessInTransactionEffect(
        transaction,
        prepared.graph.installation,
        prepared.readiness,
      ));
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(readinessCount(persistence)).resolves.toBe("0");

    const cause = new Error("readiness driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaReadinessInTransactionEffect(
          rejectingReadinessRootSelectTransaction(transaction, cause),
          prepared.graph.installation,
          prepared.readiness,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readReadiness",
      reason: "resourceFailure",
      cause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function captureReadiness(
  installation: RestoredFrameworkSchemaInstallation,
  validatedAt: string,
) {
  const capabilities =
    installation.installation.frame.installedPhysicalCapabilities;
  return runEffect(captureFrameworkSchemaReadiness({
    installation: installation.installation,
    validationSha256: VALIDATION_SHA256,
    validatedStructureSha256:
      installation.installation.frame.installedStructureSha256,
    validatedPhysicalCapabilities: capabilities,
    residualRequirements: capabilities.map(capability => Object.freeze({
      capability: capability.identity,
      requirement: capability.residualRequirement,
    })),
    validatedAt,
  }));
}

async function storedReadinessFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const values = await createSuccessfulTerminalPlanValues();
  return persistence.drizzle.transaction(async transaction => {
    const graph = await storeSuccessfulInstallationGraphInTransaction(
      transaction,
      values,
    );
    const readiness = await captureReadiness(
      graph.installation,
      FIRST_VALIDATED_AT,
    );
    const ensured = await runEffect(
      ensureFrameworkSchemaReadinessInTransactionEffect(
        transaction,
        graph.installation,
        readiness,
      ),
    );
    return { graph, readiness, ensured };
  });
}

async function readinessCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_schema_readiness
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing readiness count row");
  return row.count;
}

async function storedReadinessRows(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkSchemaReadiness,
  ).orderBy(asc(fxSystemFrameworkSchemaReadiness.readinessStorageId));
  return rows.map(row => ({
    readinessStorageId: row.readinessStorageId,
    installationStorageId: row.installationStorageId,
    installationSha256: Encoding.encodeHex(row.installationSha256),
    installationReceiptSha256:
      Encoding.encodeHex(row.installationReceiptSha256),
    readinessSha256: Encoding.encodeHex(row.readinessSha256),
    validationSha256: Encoding.encodeHex(row.validationSha256),
    validatedStructureSha256:
      Encoding.encodeHex(row.validatedStructureSha256),
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  }));
}

function expectedReadinessRow(
  restored: RestoredFrameworkSchemaReadiness,
) {
  const { installation, readiness } = restored;
  return {
    readinessStorageId: restored.storageId,
    installationStorageId: installation.storageId,
    installationSha256:
      installation.installation.frame.identity.installationSha256,
    installationReceiptSha256: installation.installation.sha256,
    readinessSha256: readiness.sha256,
    validationSha256: readiness.frame.validationSha256,
    validatedStructureSha256: readiness.frame.validatedStructureSha256,
    frameFormat: readiness.frame.format,
    frameVersion: readiness.frame.version,
    canonicalByteLength: canonicalBytes(readiness).byteLength,
    canonicalBytes: canonicalBytes(readiness),
  };
}

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation: "ensureReadiness" | "readReadiness",
  effect: (
    transaction: FlarexMetadataTransaction,
  ) => Effect.Effect<unknown, FrameworkMigrationRepositoryError>,
): Promise<void> {
  const failure = await persistence.drizzle.transaction(
    transaction => runEffectFailure(effect(transaction)),
  );
  expect(failure).toMatchObject({ operation, reason: "storedCorruption" });
}

function canonicalBytes(value: Readonly<{ canonicalJson: string }>): Uint8Array {
  return new TextEncoder().encode(value.canonicalJson);
}

function rejectingReadinessRootSelectTransaction(
  transaction: FlarexMetadataTransaction,
  cause: unknown,
): FlarexMetadataTransaction {
  function rejectAtLimit(input: UnknownRecord): UnknownRecord {
    return new Proxy(input, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        if (property === "limit") return () => Promise.reject(cause);
        return (...args: unknown[]) => {
          const next = Reflect.apply(member, target, args);
          if (!isNonArrayRecord(next)) {
            throw new TypeError("Readiness read builder must remain an object");
          }
          return rejectAtLimit(next);
        };
      },
    });
  }

  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      const select = Reflect.get(target, property, receiver);
      if (typeof select !== "function") return select;
      return (...args: unknown[]) => {
        const query = Reflect.apply(select, target, args);
        if (!isReadinessRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Readiness select must return an object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isReadinessRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "readinessStorageId") &&
    Object.hasOwn(input, "validationSha256") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}
