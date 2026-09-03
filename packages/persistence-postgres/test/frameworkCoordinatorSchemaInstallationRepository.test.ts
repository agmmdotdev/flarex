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
  captureFrameworkSchemaInstallation,
} from "../src/frameworkSchema/installation/canonical";
import {
  ensureFrameworkSchemaInstallationInTransactionEffect,
  readFrameworkSchemaInstallationInTransactionEffect,
} from "../src/frameworkSchema/installation/installationRepository";
import {
  fxSystemFrameworkSchemaInstallations,
} from "../src/frameworkSchema/installation/schema";
import type {
  RestoredFrameworkSchemaInstallation,
} from "../src/frameworkSchema/installation/storedMetadataRestoration";
import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulTerminalGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 90_000;
const FIRST_INSTALLED_AT = "2026-08-27T08:34:00.000Z";
const SECOND_INSTALLED_AT = "2026-08-27T08:35:00.000Z";

describe("framework coordinator schema-installation repository", () => {
  it("keeps the installation transaction kernel source-private", async () => {
    expect(
      "ensureFrameworkSchemaInstallationInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkSchemaInstallationInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/installation/installationRepository.ts",
    );
  });

  it("reads absence, ensures exact normalized storage, and replays", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulTerminalGraphInTransaction(
          transaction,
          values,
        );
        const installation = await captureInstallation(
          graph,
          FIRST_INSTALLED_AT,
        );
        const missing = await runEffect(
          readFrameworkSchemaInstallationInTransactionEffect(
            transaction,
            graph.terminal,
            installation,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);
        const ensured = await runEffect(
          ensureFrameworkSchemaInstallationInTransactionEffect(
            transaction,
            graph.terminal,
            installation,
          ),
        );
        const replayed = await runEffect(
          ensureFrameworkSchemaInstallationInTransactionEffect(
            transaction,
            graph.terminal,
            installation,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkSchemaInstallationInTransactionEffect(
            transaction,
            graph.terminal,
            installation,
          ),
        ));
        expect(replayed.storageId).toBe(ensured.storageId);
        expect(read).toEqual(ensured);
        return { graph, installation, ensured };
      },
    );

    const independentlyCaptured = await captureInstallation(
      stored.graph,
      FIRST_INSTALLED_AT,
    );
    expect(independentlyCaptured).not.toBe(stored.installation);
    const separateReplay = await persistence.drizzle.transaction(
      transaction => runEffect(
        ensureFrameworkSchemaInstallationInTransactionEffect(
          transaction,
          stored.graph.terminal,
          independentlyCaptured,
        ),
      ),
    );
    expect(separateReplay.storageId).toBe(stored.ensured.storageId);
    await expect(installationCount(persistence)).resolves.toBe("1");
    await expect(storedInstallationRows(persistence)).resolves.toEqual([
      expectedInstallationRow(stored.ensured),
    ]);
  }, PGLITE_TEST_TIMEOUT);

  it("refuses a missing terminal and preserves semantic identity conflicts", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulTerminalGraphInTransaction(
          transaction,
          values,
        );
        const installation = await captureInstallation(
          graph,
          FIRST_INSTALLED_AT,
        );
        const ensured = await runEffect(
          ensureFrameworkSchemaInstallationInTransactionEffect(
            transaction,
            graph.terminal,
            installation,
          ),
        );
        return { graph, installation, ensured };
      },
    );
    const conflicting = await captureInstallation(
      stored.graph,
      SECOND_INSTALLED_AT,
    );
    expect(conflicting.frame.identity.installationSha256).toBe(
      stored.installation.frame.identity.installationSha256,
    );
    expect(conflicting.sha256).not.toBe(stored.installation.sha256);
    const conflict = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkSchemaInstallationInTransactionEffect(
          transaction,
          stored.graph.terminal,
          conflicting,
        ),
      ),
    );
    expect(conflict).toMatchObject({
      operation: "ensureInstallation",
      reason: "immutableConflict",
    });
    await expect(storedInstallationRows(persistence)).resolves.toEqual([
      expectedInstallationRow(stored.ensured),
    ]);

    const emptyPersistence = await createMigratedPGlitePersistence();
    const missing = await emptyPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaInstallationInTransactionEffect(
          transaction,
          stored.graph.terminal,
          stored.installation,
        ),
      ),
    );
    expect(missing).toMatchObject({
      operation: "readInstallation",
      reason: "referenceRefusal",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("rejects changed and over-limit canonical bytes without healing", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await storedInstallationFixture(
      projectionPersistence,
    );
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkSchemaInstallations,
    ).set({ installedStructureSha256: new Uint8Array(32).fill(0x7f) }).where(
      eq(
        fxSystemFrameworkSchemaInstallations.installationStorageId,
        projection.ensured.storageId,
      ),
    );
    const projectionBefore = await storedInstallationRows(
      projectionPersistence,
    );
    await expectStoredCorruption(
      projectionPersistence,
      "ensureInstallation",
      transaction => ensureFrameworkSchemaInstallationInTransactionEffect(
        transaction,
        projection.graph.terminal,
        projection.installation,
      ),
    );
    await expect(storedInstallationRows(projectionPersistence)).resolves
      .toEqual(projectionBefore);

    const corruptPersistence = await createMigratedPGlitePersistence();
    const corrupt = await storedInstallationFixture(corruptPersistence);
    const changedBytes = canonicalBytes(corrupt.installation);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await corruptPersistence.drizzle.update(
      fxSystemFrameworkSchemaInstallations,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkSchemaInstallations.installationStorageId,
      corrupt.ensured.storageId,
    ));
    await expectStoredCorruption(
      corruptPersistence,
      "readInstallation",
      transaction => readFrameworkSchemaInstallationInTransactionEffect(
        transaction,
        corrupt.graph.terminal,
        corrupt.installation,
      ),
    );
    await expect(installationCount(corruptPersistence)).resolves.toBe("1");

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await storedInstallationFixture(oversizedPersistence);
    await oversizedPersistence.query(`
      alter table fx_system_framework_schema_installation
        drop constraint fx_framework_installation_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkSchemaInstallations,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkSchemaInstallations.installationStorageId,
      oversized.ensured.storageId,
    ));
    const before = await storedInstallationRows(oversizedPersistence);
    await expectStoredCorruption(
      oversizedPersistence,
      "ensureInstallation",
      transaction => ensureFrameworkSchemaInstallationInTransactionEffect(
        transaction,
        oversized.graph.terminal,
        oversized.installation,
      ),
    );
    await expect(storedInstallationRows(oversizedPersistence)).resolves
      .toEqual(before);
  }, 120_000);

  it("follows caller rollback and preserves the exact driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const prepared = await persistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulTerminalGraphInTransaction(
          transaction,
          values,
        );
        const installation = await captureInstallation(
          graph,
          FIRST_INSTALLED_AT,
        );
        return { graph, installation };
      },
    );
    const rollback = new Error("deliberate installation rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(ensureFrameworkSchemaInstallationInTransactionEffect(
        transaction,
        prepared.graph.terminal,
        prepared.installation,
      ));
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(installationCount(persistence)).resolves.toBe("0");

    const cause = new Error("installation driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaInstallationInTransactionEffect(
          rejectingInstallationRootSelectTransaction(transaction, cause),
          prepared.graph.terminal,
          prepared.installation,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readInstallation",
      reason: "resourceFailure",
      cause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function captureInstallation(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulTerminalGraphInTransaction
  >>,
  installedAt: string,
) {
  return runEffect(captureFrameworkSchemaInstallation({
    plan: graph.plan.plan,
    admission: graph.admission.admission,
    terminal: graph.terminal.terminal,
    installedStructureSha256: graph.plan.plan.physicalLayout.layoutSha256,
    installedPhysicalCapabilities:
      graph.plan.plan.physicalLayout.frame.requiredPhysicalCapabilities,
    installedAt,
  }));
}

async function storedInstallationFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const values = await createSuccessfulTerminalPlanValues();
  return persistence.drizzle.transaction(async transaction => {
    const graph = await storeSuccessfulTerminalGraphInTransaction(
      transaction,
      values,
    );
    const installation = await captureInstallation(graph, FIRST_INSTALLED_AT);
    const ensured = await runEffect(
      ensureFrameworkSchemaInstallationInTransactionEffect(
        transaction,
        graph.terminal,
        installation,
      ),
    );
    return { graph, installation, ensured };
  });
}

async function installationCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_schema_installation
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing installation count row");
  return row.count;
}

async function storedInstallationRows(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkSchemaInstallations,
  ).orderBy(asc(
    fxSystemFrameworkSchemaInstallations.installationStorageId,
  ));
  return rows.map(row => ({
    installationStorageId: row.installationStorageId,
    collisionStorageId: row.collisionStorageId,
    planStorageId: row.planStorageId,
    migrationPlanSha256: Encoding.encodeHex(row.migrationPlanSha256),
    admissionStorageId: row.admissionStorageId,
    admissionSha256: Encoding.encodeHex(row.admissionSha256),
    terminalStorageId: row.terminalStorageId,
    terminalOutcomeKind: row.terminalOutcomeKind,
    terminalSha256: Encoding.encodeHex(row.terminalSha256),
    installationSha256: Encoding.encodeHex(row.installationSha256),
    installationReceiptSha256:
      Encoding.encodeHex(row.installationReceiptSha256),
    installedStructureSha256:
      Encoding.encodeHex(row.installedStructureSha256),
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  }));
}

function expectedInstallationRow(
  restored: RestoredFrameworkSchemaInstallation,
) {
  const { installation, terminal } = restored;
  return {
    installationStorageId: restored.storageId,
    collisionStorageId: restored.collision.storageId,
    planStorageId: restored.plan.storageId,
    migrationPlanSha256: restored.plan.plan.migrationPlanSha256,
    admissionStorageId: restored.admission.storageId,
    admissionSha256: restored.admission.admission.sha256,
    terminalStorageId: terminal.storageId,
    terminalOutcomeKind: "succeeded",
    terminalSha256: terminal.terminal.sha256,
    installationSha256: installation.frame.identity.installationSha256,
    installationReceiptSha256: installation.sha256,
    installedStructureSha256: installation.frame.installedStructureSha256,
    frameFormat: installation.frame.format,
    frameVersion: installation.frame.version,
    canonicalByteLength: canonicalBytes(installation).byteLength,
    canonicalBytes: canonicalBytes(installation),
  };
}

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation: "ensureInstallation" | "readInstallation",
  effect: (
    transaction: FlarexMetadataTransaction,
  ) => Effect.Effect<unknown, FrameworkMigrationRepositoryError>,
): Promise<void> {
  const failure = await persistence.drizzle.transaction(
    transaction => runEffectFailure(effect(transaction)),
  );
  expect(failure).toMatchObject({
    operation,
    reason: "storedCorruption",
  });
}

function canonicalBytes(value: Readonly<{ canonicalJson: string }>): Uint8Array {
  return new TextEncoder().encode(value.canonicalJson);
}

function rejectingInstallationRootSelectTransaction(
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
            throw new TypeError("Installation read builder must be an object");
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
        if (!isInstallationRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Installation select must return an object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isInstallationRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "installationStorageId") &&
    Object.hasOwn(input, "terminalOutcomeKind") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}
