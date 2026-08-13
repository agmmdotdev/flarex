import { webcrypto } from "node:crypto";
import {
  encodeTaskRuntimePublicationReceipt,
  hashTaskRuntimePublicationReceipt,
  makeLiveStandardApplicationTaskSha256V1,
  type TaskDefinitionSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { createApplicationTaskCatalogSnapshotPort } from
  "../src/applicationTaskBindings";
import { makeApplicationTaskRuntimePublicationRepository } from
  "../src/applicationTaskRuntimePublication";
import {
  createApplicationTaskRuntimeReadinessSnapshotPort,
} from "../src/applicationTaskRuntimeReadinessSnapshot";
import { runEffect } from "./effectTestRuntime";
import {
  makeTaskRuntimePublicationFixture,
  type TaskRuntimePublicationFixture,
} from "./applicationTaskRuntimePublicationTestSupport";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application task-runtime readiness snapshot", () => {
  it("returns null before the current runtime publication exists", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    expect(await loadSnapshot(fixture)).toBeNull();
  });

  it("independently correlates populated parent and receipt evidence", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    await publish(fixture);
    const snapshot = await loadSnapshot(fixture);
    if (snapshot === null) throw new Error("Expected readiness snapshot.");
    const captured = Result.getOrThrow(
      fixture.receiptAuthority.captureReceipt(fixture.publication),
    );
    const parent = snapshot.readParentEvidence();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.receiptObjectCount).toBe(7);
    expect(snapshot.readReceiptCanonicalBytes()).toEqual(captured.canonicalBytes);
    expect(snapshot.readReceiptSha256()).toEqual(captured.sha256);
    expect(parent).toMatchObject({
      scopeId: captured.receipt.scopeId,
      candidateId: captured.receipt.candidateId,
      analysisId: captured.receipt.analysisId,
      applicationRevisionId: captured.receipt.applicationRevisionId,
    });
    expect(parent.applicationPublicationSha256)
      .toEqual(captured.receipt.applicationPublicationSha256);
    expect(parent.sourceArtifactRootSha256)
      .toEqual(captured.receipt.sourceArtifactRootSha256);
    expect(parent.applicationTaskCatalogBindingSha256)
      .toEqual(captured.receipt.applicationTaskCatalogBindingSha256);
    expect(parent.taskCatalog.taskCatalogSha256)
      .toEqual(captured.receipt.taskCatalogSha256);
    expect(parent.taskCatalog.entries).toHaveLength(1);
  });

  it("returns the explicit empty publication with an owned empty catalog", async () => {
    const fixture = await makeTaskRuntimePublicationFixture(true);
    await publish(fixture);
    const snapshot = await loadSnapshot(fixture);
    if (snapshot === null) throw new Error("Expected empty readiness snapshot.");

    expect(snapshot.receiptObjectCount).toBe(0);
    expect(snapshot.readParentEvidence().taskCatalog.entries).toEqual([]);
  });

  it("returns copy-on-read receipt and parent evidence", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    await publish(fixture);
    const snapshot = await loadSnapshot(fixture);
    if (snapshot === null) throw new Error("Expected readiness snapshot.");
    const expectedReceipt = snapshot.readReceiptCanonicalBytes();
    const expectedReceiptSha256 = snapshot.readReceiptSha256();
    const expectedCatalogSha256 =
      snapshot.readParentEvidence().taskCatalog.taskCatalogSha256;

    snapshot.readReceiptCanonicalBytes().fill(0);
    snapshot.readReceiptSha256().fill(0);
    const parent = snapshot.readParentEvidence();
    parent.applicationPublicationSha256.fill(0);
    parent.taskCatalog.taskCatalogSha256.fill(0);
    parent.taskCatalog.entries[0]?.canonicalTaskManifestSha256.fill(0);

    expect(snapshot.readReceiptCanonicalBytes()).toEqual(expectedReceipt);
    expect(snapshot.readReceiptSha256()).toEqual(expectedReceiptSha256);
    expect(snapshot.readParentEvidence().taskCatalog.taskCatalogSha256)
      .toEqual(expectedCatalogSha256);
  });

  it("rejects a self-consistent receipt whose Application parent differs", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    await publish(fixture);
    const captured = Result.getOrThrow(
      fixture.receiptAuthority.captureReceipt(fixture.publication),
    );
    const changedPublicationSha256 = new Uint8Array(32).fill(0xee) as
      TaskDefinitionSha256V1;
    const changedReceipt = Object.freeze({
      ...captured.receipt,
      applicationPublicationSha256: changedPublicationSha256,
    });
    const changedBytes = Result.getOrThrow(
      encodeTaskRuntimePublicationReceipt(changedReceipt),
    );
    const changedSha256 = await runEffect(hashTaskRuntimePublicationReceipt(
      changedReceipt,
      makeLiveStandardApplicationTaskSha256V1(),
    ));

    await fixture.persistence.query(`
      alter table fx_system_application_task_runtime_object_v1
      drop constraint fx_application_task_runtime_obj_v1_publication_fk
    `);
    await fixture.persistence.query(`
      alter table fx_system_application_task_runtime_publication_v1
      drop constraint fx_application_task_runtime_pub_v1_catalog_fk
    `);
    await fixture.persistence.query(`
      update fx_system_application_task_runtime_object_v1
      set receipt_sha256 = decode(
        '${encodeBytesToLowercaseHex(changedSha256)}', 'hex'
      )
    `);
    await fixture.persistence.query(`
      update fx_system_application_task_runtime_publication_v1
      set application_publication_sha256 = decode(
            '${encodeBytesToLowercaseHex(changedPublicationSha256)}', 'hex'
          ),
          receipt_sha256 = decode(
            '${encodeBytesToLowercaseHex(changedSha256)}', 'hex'
          ),
          receipt_bytes = decode(
            '${encodeBytesToLowercaseHex(changedBytes)}', 'hex'
          )
    `);

    const outcome = await loadSnapshotResult(fixture);
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({
        _tag: "ApplicationTaskRuntimeReadinessSnapshotError",
        reason: "authorityMismatch",
        retryable: false,
      });
    }
  });

  it("fails closed on normalized membership drift", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    await publish(fixture);
    await fixture.persistence.query(`
      alter table fx_system_application_task_runtime_object_v1
      drop constraint fx_application_task_runtime_obj_v1_shape_check
    `);
    await fixture.persistence.query(`
      update fx_system_application_task_runtime_object_v1
      set codec_identity = 'corrupt'
      where role = 'task_runtime_entry'
    `);

    const outcome = await loadSnapshotResult(fixture);
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({
        _tag: "ApplicationTaskRuntimeReadinessSnapshotError",
        reason: "storedState",
      });
    }
  });

  it("rejects a structural substitute for the catalog snapshot owner", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    const structural = {
      loadInTransaction: createApplicationTaskCatalogSnapshotPort()
        .loadInTransaction,
    };
    const port = createApplicationTaskRuntimeReadinessSnapshotPort(structural);
    const captured = Result.getOrThrow(
      fixture.receiptAuthority.captureReceipt(fixture.publication),
    );
    const outcome = await fixture.persistence.drizzle.transaction(tx =>
      runEffect(Effect.result(port.loadInTransaction(
        tx,
        fixture.authority,
        captured.receipt.applicationRevisionId,
      )))
    );
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({
        _tag: "ApplicationTaskRuntimeReadinessSnapshotError",
        reason: "invalidInput",
      });
    }
  });
});

async function publish(fixture: TaskRuntimePublicationFixture): Promise<void> {
  await runEffect(makeApplicationTaskRuntimePublicationRepository(
    fixture.db,
    fixture.receiptAuthority,
  ).publish({
    authority: fixture.authority,
    publication: fixture.publication,
  }));
}

async function loadSnapshot(fixture: TaskRuntimePublicationFixture) {
  const outcome = await loadSnapshotResult(fixture);
  return Result.getOrThrow(outcome);
}

async function loadSnapshotResult(fixture: TaskRuntimePublicationFixture) {
  const captured = Result.getOrThrow(
    fixture.receiptAuthority.captureReceipt(fixture.publication),
  );
  const port = createApplicationTaskRuntimeReadinessSnapshotPort(
    createApplicationTaskCatalogSnapshotPort(),
  );
  return fixture.persistence.drizzle.transaction(tx => runEffect(
    Effect.result(port.loadInTransaction(
      tx,
      fixture.authority,
      captured.receipt.applicationRevisionId,
    )),
  ));
}
