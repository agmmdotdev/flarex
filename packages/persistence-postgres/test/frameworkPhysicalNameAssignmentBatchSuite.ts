import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { ensureRelationalPhysicalNameAssignmentsInTransactionEffect as ensureAssignments } from "../src/migrationCoordination/physicalNameAssignmentRepository";
import { fxSystemRelationalPhysicalNameAssignments as assignments } from "../src/migrationCoordination/schema";
import { ensureFrameworkMigrationCollisionDomainInTransactionEffect, ensureFrameworkSchemaTargetNamespaceInTransactionEffect } from "../src/migrationCoordination/targetCollisionRepository";
import { captureRelationalPhysicalLayout, MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES } from "../src/relationalSchema/physical/canonical";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureFrameworkSchemaTargetNamespace } from "../src/migrationCoordination/targetNamespace";
import { MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS } from "../src/relationalSchema/physical/storedValidation";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace, syntheticSchemaInput, syntheticSystemArtifact } from "./frameworkMigrationValueFixtures";

type Persistence = { readonly drizzle: FlarexMetadataDatabase };
type WithPersistence = (run: (persistence: Persistence) => Promise<void>) => Promise<void>;

export async function assignmentBatchValues(longIdentity = false) {
  const ordinary = await syntheticSystemArtifact(20);
  // Escaping a valid bounded identity expands canonical evidence; no forged frame.
  const deploymentId = "\\".repeat(500);
  const artifact = longIdentity ? await runEffect(captureRelationalSchemaArtifact({
    deploymentId, provenance: { kind: "synthetic", fixtureId: "large-assignment-evidence" }, schema: syntheticSchemaInput(),
  })) : ordinary;
  const target = longIdentity ? await runEffect(captureFrameworkSchemaTargetNamespace({
    deploymentId, physicalDatabaseIdentity: "postgres-cluster-a/database-a", schemaName: FRAMEWORK_VALUE_LOCATOR.schemaName,
  })) : await frameworkTargetNamespace();
  const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: target }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: artifact.artifact, physicalLayout: layout }));
  return { target, plan, inventory: layout.nameAssignments };
}

export async function assignmentBatchParents(transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof assignmentBatchValues>>) {
  const target = await runEffect(ensureFrameworkSchemaTargetNamespaceInTransactionEffect(transaction, values.target));
  return runEffect(ensureFrameworkMigrationCollisionDomainInTransactionEffect(transaction, target, values.plan));
}

export function assignmentBatchSuite(withPersistence: WithPersistence) {
  it("batches a neutral inventory and replays in caller order with bounded SQL work", async () => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues();
      expect(values.inventory.length).toBeGreaterThan(64);
      await persistence.drizzle.transaction(async transaction => {
        const collision = await assignmentBatchParents(transaction, values);
        const insert = vi.spyOn(transaction, "insert");
        const select = vi.spyOn(transaction, "select");
        const first = await runEffect(ensureAssignments(transaction, collision, values.inventory));
        const chunks = Math.ceil(values.inventory.length / 64);
        expect(insert).toHaveBeenCalledTimes(chunks);
        expect(select.mock.calls.length).toBeLessThanOrEqual(chunks + 3);
        expect(first.map(row => row.assignment.assignmentSha256)).toEqual(values.inventory.map(value => value.assignmentSha256));
        insert.mockClear(); select.mockClear();
        const reverse = await runEffect(ensureAssignments(transaction, collision, [...values.inventory].reverse()));
        expect(reverse.map(row => row.storageId)).toEqual(first.map(row => row.storageId).reverse());
        expect(insert).toHaveBeenCalledTimes(chunks);
        expect(select.mock.calls.length).toBeLessThanOrEqual(chunks + 3);
        const one = first[0];
        if (one === undefined) throw new Error("Missing first assignment");
        const duplicates = await runEffect(ensureAssignments(transaction, collision, [one.assignment, one.assignment]));
        expect(duplicates.map(row => row.storageId)).toEqual([one.storageId, one.storageId]);
        insert.mockRestore(); select.mockRestore();
      });
      expect(await persistence.drizzle.select().from(assignments)).toHaveLength(values.inventory.length);
    });
  });

  it("validates the entire input before writes and rejects oversized inventories", async () => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues();
      await persistence.drizzle.transaction(async transaction => {
        const collision = await assignmentBatchParents(transaction, values);
        const first = values.inventory[0];
        if (first === undefined) throw new Error("Missing first assignment");
        const insert = vi.spyOn(transaction, "insert");
        expect(await runEffect(ensureAssignments(transaction, collision, []))).toEqual([]);
        expect(await runEffectFailure(ensureAssignments(transaction, collision, [...values.inventory,
          { ...first, canonicalJson: `${first.canonicalJson} ` }]))).toMatchObject({ reason: "referenceRefusal" });
        expect(await runEffectFailure(ensureAssignments(transaction, collision,
          Array.from({ length: MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS + 1 }, () => first))))
          .toMatchObject({ reason: "referenceRefusal" });
        expect(insert).not.toHaveBeenCalled();
        insert.mockRestore();
      });
      expect(await persistence.drizzle.select().from(assignments)).toHaveLength(0);
    });
  });

  it("splits large canonical evidence before the row limit and refuses aggregate evidence before writes", async () => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues(true);
      const first = values.inventory[0];
      if (first === undefined) throw new Error("Missing first assignment");
      const byteLength = new TextEncoder().encode(first.canonicalJson).byteLength;
      expect(byteLength).toBeGreaterThan(262_144 / 64);
      await persistence.drizzle.transaction(async transaction => {
        const collision = await assignmentBatchParents(transaction, values);
        const insert = vi.spyOn(transaction, "insert");
        const rows = await runEffect(ensureAssignments(transaction, collision, Array.from({ length: 64 }, () => first)));
        expect(rows).toHaveLength(64);
        expect(insert).toHaveBeenCalledTimes(Math.ceil(64 / Math.floor(262_144 / byteLength)));
        insert.mockClear();
        const tooMany = Math.floor(MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES / byteLength) + 1;
        expect(tooMany).toBeLessThan(MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS);
        expect(await runEffectFailure(ensureAssignments(transaction, collision, Array.from({ length: tooMany }, () => first))))
          .toMatchObject({ reason: "referenceRefusal" });
        expect(insert).not.toHaveBeenCalled();
        insert.mockRestore();
      });
    });
  });

  it.each(["canonicalBytes", "nameSha256"] as const)("refuses corrupt %s and rolls back every newly inserted chunk", async column => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues();
      const first = values.inventory[0];
      if (first === undefined) throw new Error("Missing first assignment");
      const collision = await persistence.drizzle.transaction(transaction => assignmentBatchParents(transaction, values));
      const [stored] = await persistence.drizzle.transaction(transaction => runEffect(ensureAssignments(transaction, collision, [first])));
      if (stored === undefined) throw new Error("Missing stored assignment");
      const badBytes = new TextEncoder().encode(first.canonicalJson);
      badBytes[badBytes.length - 2] = 0x20;
      await persistence.drizzle.update(assignments).set(column === "canonicalBytes"
        ? { canonicalBytes: badBytes } : { nameSha256: new Uint8Array(32) })
        .where(eq(assignments.assignmentStorageId, stored.storageId));
      await expect(persistence.drizzle.transaction(transaction => runEffect(ensureAssignments(transaction, collision,
        [...values.inventory.slice(1), first])))).rejects.toMatchObject({ reason: "storedCorruption" });
      expect(await persistence.drizzle.select().from(assignments)).toHaveLength(1);
    });
  });

  it("leaves rollback settlement with the transaction owner", async () => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues();
      const collision = await persistence.drizzle.transaction(transaction => assignmentBatchParents(transaction, values));
      const abort = new Error("owner cancels transaction");
      await expect(persistence.drizzle.transaction(async transaction => {
        await runEffect(ensureAssignments(transaction, collision, values.inventory));
        throw abort;
      })).rejects.toBe(abort);
      expect(await persistence.drizzle.select().from(assignments)).toHaveLength(0);
    });
  });

  it("rolls back inserted batches when the owning Effect is interrupted", async () => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues();
      const collision = await persistence.drizzle.transaction(transaction => assignmentBatchParents(transaction, values));
      await expect(persistence.drizzle.transaction(transaction => runEffect(Effect.gen(function* () {
        yield* ensureAssignments(transaction, collision, values.inventory);
        yield* Effect.interrupt;
      })))).rejects.toBeDefined();
      expect(await persistence.drizzle.select().from(assignments)).toHaveLength(0);
    });
  });
}
