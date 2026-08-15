import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1, type AppRowIdHexV1 } from
  "flarex-protocol/app-document-id";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  appSchemaCandidateManifestSha256HexV1FromBytes,
  AppSchemaCandidateValidationOperationV1Error,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1,
} from
  "flarex-protocol/internal/app-schema-candidate-validation-v1";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  advanceAppSchemaCandidateValidationEffect,
  applyAppSchemaCandidateWriteGuardInTransactionEffect,
  canonicalizeBoundedFailureEvidenceFrameEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createAppSchemaCandidateWriteGuardPort,
  createLocatedAppSchemaCandidateValidationTarget,
  hasAppSchemaCandidateValidationComposition,
  hasAppSchemaCandidateWriteGuardComposition,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateReadinessEffect,
  loadAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
  prepareAppSchemaCandidateWriteGuardEffect,
  validateAppSchemaCandidateReadinessInTransactionEffect,
} from "../src/appSchemaCandidateValidation";
import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appRows";
import { createPGlitePersistence } from "../src/pglite";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { lockScopeClockForUpdateInTransactionEffect } from
  "../src/scopeClock";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "../src/transactionSessionActivation";
import { LocatedReadCommittedTransactionFailureV1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);
let fixtureOrdinal = 0;

describe("M03-A app-schema candidate validation", () => {
  it("projects exact missing, progress, receipt, failure, and replacement readiness", async () => {
    const fixture = await fixtureFor("readiness");
    const validation = port(fixture);
    const readiness = createAppSchemaCandidateReadinessPort(validation);

    await expect(runEffect(loadAppSchemaCandidateReadinessEffect(
      readiness,
      readinessInput(
        fixture,
        fixture.schemaVersionId,
        fixture.schemaManifestSha256Hex,
      ),
    ))).resolves.toEqual({ status: "not_ready", reason: "missing" });

    await runEffect(installAppSchemaCandidateValidationEffect(
      validation,
      input(fixture, fixture.schemaVersionId),
    ));
    await expect(runEffect(loadAppSchemaCandidateReadinessEffect(
      readiness,
      readinessInput(
        fixture,
        fixture.schemaVersionId,
        fixture.schemaManifestSha256Hex,
      ),
    ))).resolves.toEqual({ status: "not_ready", reason: "inProgress" });

    await runEffect(advanceAppSchemaCandidateValidationEffect(
      validation,
      input(fixture, fixture.schemaVersionId),
    ));
    const receipt = await runEffect(settleAppSchemaCandidateValidationEffect(
      validation,
      input(fixture, fixture.schemaVersionId),
    ));
    const ready = await runEffect(loadAppSchemaCandidateReadinessEffect(
      readiness,
      readinessInput(
        fixture,
        fixture.schemaVersionId,
        fixture.schemaManifestSha256Hex,
      ),
    ));
    expect(ready).toMatchObject({
      status: "ready",
      evidence: {
        schemaVersionId: fixture.schemaVersionId,
        receiptSha256Hex: receipt.frameSha256Hex,
      },
    });
    if (ready.status !== "ready") {
      throw new Error("Candidate readiness receipt was not available.");
    }

    const copiedReadiness = { ...readiness } as typeof readiness;
    await expect(runEffectFailure(loadAppSchemaCandidateReadinessEffect(
      copiedReadiness,
      readinessInput(
        fixture,
        fixture.schemaVersionId,
        fixture.schemaManifestSha256Hex,
      ),
    ))).resolves.toMatchObject({
      _tag: "AppSchemaCandidateReadinessError",
      reason: "invalidPort",
    });

    await appendLive(fixture, rowId(1), 1n, null, { name: 42 });
    await setClockCommit(fixture, 1n);
    await runEffect(installAppSchemaCandidateValidationEffect(
      validation,
      input(fixture, fixture.replacementSchemaVersionId),
    ));
    const currentClock = await fixture.target.getCurrentClock(fixture.scopeId);
    if (currentClock === null) throw new Error("Missing scope clock.");
    const authority = Object.freeze({
      deploymentId: fixture.deploymentId,
      scopeId: fixture.scopeId,
      physicalLocator: LOCATOR,
      storageGeneration: currentClock.storageGeneration,
      storageGenerationFence: currentClock.storageGenerationFence,
      epoch: currentClock.epoch,
      lastCommitSeq: currentClock.lastCommitSeq,
      lastOutboxSeq: currentClock.lastOutboxSeq,
    });
    await expect(fixture.persistence.drizzle.transaction(tx => runEffect(
      Effect.gen(function* () {
        const lockedClock = yield*
          lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId);
        return yield* validateAppSchemaCandidateReadinessInTransactionEffect(
          tx,
          readiness,
          ready.evidence,
          authority,
          lockedClock,
          "update",
        );
      }),
    ))).resolves.toEqual({ status: "not_ready", reason: "wrongSchema" });
    await expect(runEffect(loadAppSchemaCandidateReadinessEffect(
      readiness,
      readinessInput(
        fixture,
        fixture.schemaVersionId,
        fixture.schemaManifestSha256Hex,
      ),
    ))).resolves.toEqual({ status: "not_ready", reason: "wrongSchema" });

    await runEffect(advanceAppSchemaCandidateValidationEffect(
      validation,
      input(fixture, fixture.replacementSchemaVersionId),
    ));
    await expect(runEffect(loadAppSchemaCandidateReadinessEffect(
      readiness,
      readinessInput(
        fixture,
        fixture.replacementSchemaVersionId,
        fixture.replacementSchemaManifestSha256Hex,
      ),
    ))).resolves.toEqual({ status: "not_ready", reason: "failed" });
  });

  it("installs one head, replays exactly, and supersedes a different candidate", async () => {
    const fixture = await fixtureFor("install");
    const first = await install(fixture, fixture.schemaVersionId);
    expect(first).toMatchObject({
      disposition: "installed",
      head: {
        scopeId: fixture.scopeId,
        schemaVersionId: fixture.schemaVersionId,
        frame: {
          kind: "app_schema_candidate_validation_progress",
          frontierCommitSeq: 0n,
          attemptFence: 1n,
        },
      },
    });
    await expect(install(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "replayed",
      head: { frame: { attemptFence: 1n } },
    });

    const replacement = await install(fixture, fixture.replacementSchemaVersionId);
    expect(replacement).toMatchObject({
      disposition: "superseded",
      head: {
        schemaVersionId: fixture.replacementSchemaVersionId,
        frame: { attemptFence: 2n },
      },
    });
    await expect(runEffectFailure(loadAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({
      _tag: "AppSchemaCandidateValidationOperationV1Error",
      operation: "load",
      reason: "superseded",
    });
  });

  it("scans authoritative revisions at the pinned frontier and settles", async () => {
    const fixture = await fixtureFor("frontier");
    await appendLive(fixture, rowId(1), 1n, null, { name: "before" });
    await setClockCommit(fixture, 1n);
    await install(fixture, fixture.schemaVersionId);

    await appendLive(fixture, rowId(1), 2n, 1n, { name: 42 });
    await setClockCommit(fixture, 2n);
    const advanced = await advance(fixture, fixture.schemaVersionId);
    expect(advanced).toMatchObject({
      disposition: "readyToSettle",
      processedIdentities: 1,
      validatedRows: 1,
      head: {
        frame: {
          kind: "app_schema_candidate_validation_progress",
          frontierCommitSeq: 1n,
          validatedRowCount: 1n,
          validatedPageCount: 1n,
        },
      },
    });
    const settled = await runEffect(settleAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ));
    expect(settled.frame).toMatchObject({
      kind: "app_schema_candidate_validation_receipt",
      frontierCommitSeq: 1n,
      settlementCommitSeq: 2n,
      validatedRowCount: 1n,
      scanCompleted: true,
    });
    await expect(runEffect(settleAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({
      frame: { kind: "app_schema_candidate_validation_receipt" },
    });
  });

  it("fails with bounded body-free evidence for incompatible and removed rows", async () => {
    const fixture = await fixtureFor("failure");
    await appendLive(fixture, rowId(1), 1n, null, { name: 42 });
    await setClockCommit(fixture, 1n);
    await install(fixture, fixture.schemaVersionId);
    const failed = await advance(fixture, fixture.schemaVersionId);
    expect(failed).toMatchObject({
      disposition: "failed",
      head: {
        frame: {
          kind: "app_schema_candidate_validation_failure_evidence",
          observedFailureCount: 1n,
          truncated: false,
          entries: [{
            tableId: fixture.tableId,
            rowId: rowId(1),
            observedCommitSeq: 1n,
            source: "snapshotScan",
            reason: "candidateValidatorRejected",
            validatorPath: "$document.name",
          }],
        },
      },
    });
    const entry = failed.head.frame.kind ===
        "app_schema_candidate_validation_failure_evidence"
      ? failed.head.frame.entries[0]
      : undefined;
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "observedCommitSeq",
      "reason",
      "rowId",
      "source",
      "tableId",
      "validatorPath",
    ]);

    await install(fixture, fixture.emptySchemaVersionId);
    const removed = await advance(fixture, fixture.emptySchemaVersionId);
    expect(removed).toMatchObject({
      disposition: "failed",
      head: { frame: { entries: [{
        reason: "candidateTableRemoved",
        validatorPath: null,
      }] } },
    });
  });

  it("atomically fails an active candidate from final point-commit rows", async () => {
    const fixture = await fixtureFor("write_guard");
    const dependencies = portDependencies(fixture);
    const candidateValidation = createAppSchemaCandidateValidationPort(
      dependencies,
    );
    const pointCommitAuthority = Object.freeze({
      scopeMetadata: dependencies.authority.scopeMetadata,
      provisioningReceipts: dependencies.authority.provisioningReceipts,
      scopeSessionTargets: dependencies.authority.scopeClockTargets,
    });
    const guard = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority,
    });
    await runEffect(installAppSchemaCandidateValidationEffect(
      candidateValidation,
      input(fixture, fixture.schemaVersionId),
    ));
    const prepared = await runEffect(prepareAppSchemaCandidateWriteGuardEffect(
      guard,
      { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId },
    ));
    const clock = await fixture.target.getCurrentClock(fixture.scopeId);
    if (clock === null) throw new Error("Missing scope clock.");
    const authority = Object.freeze({
      deploymentId: fixture.deploymentId,
      scopeId: fixture.scopeId,
      physicalLocator: LOCATOR,
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      lastCommitSeq: clock.lastCommitSeq,
      lastOutboxSeq: clock.lastOutboxSeq,
    });
    const document = await canonicalizeAppDocumentV1({
      tableId: fixture.tableId,
      rowId: rowId(1),
      creationTime: decodeAppCreationTimeV1(1_750_000_000_000),
      fields: { name: 42 },
    });
    const secondaryDocument = await canonicalizeAppDocumentV1({
      tableId: fixture.secondaryTableId,
      rowId: rowId(2),
      creationTime: decodeAppCreationTimeV1(1_750_000_000_001),
      fields: { name: false },
    });
    const result = await fixture.persistence.drizzle.transaction(tx =>
      runEffect(applyAppSchemaCandidateWriteGuardInTransactionEffect(
        tx,
        guard,
        prepared,
        authority,
        clock,
        CommitSeqSchema.make(1n),
        Object.freeze([
          Object.freeze({
            tableId: fixture.tableId,
            rowId: rowId(1),
            document,
          }),
          Object.freeze({
            tableId: fixture.secondaryTableId,
            rowId: rowId(2),
            document: secondaryDocument,
          }),
        ]),
      ))
    );
    expect(result).toEqual({ status: "candidateFailed" });
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      status: "present",
      head: { frame: {
        kind: "app_schema_candidate_validation_failure_evidence",
        observedFailureCount: 2n,
        entries: [
          {
            tableId: fixture.tableId,
            source: "pointCommit",
            observedCommitSeq: 1n,
            reason: "candidateValidatorRejected",
            validatorPath: "$document.name",
          },
          {
            tableId: fixture.secondaryTableId,
            source: "pointCommit",
            observedCommitSeq: 1n,
            reason: "candidateValidatorRejected",
            validatorPath: "$document.name",
          },
        ],
      } },
    });
  });

  it("keeps valid writes and deletes inert, then invalidates a settled receipt", async () => {
    const fixture = await fixtureFor("write_guard_receipt");
    const dependencies = portDependencies(fixture);
    const candidateValidation = createAppSchemaCandidateValidationPort(
      dependencies,
    );
    const pointCommitAuthority = Object.freeze({
      scopeMetadata: dependencies.authority.scopeMetadata,
      provisioningReceipts: dependencies.authority.provisioningReceipts,
      scopeSessionTargets: dependencies.authority.scopeClockTargets,
    });
    const guard = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority,
    });
    const installed = await runEffect(installAppSchemaCandidateValidationEffect(
      candidateValidation,
      input(fixture, fixture.schemaVersionId),
    ));
    const progressSha = installed.head.frameSha256Hex;
    const clock = await fixture.target.getCurrentClock(fixture.scopeId);
    if (clock === null) throw new Error("Missing scope clock.");
    const authority = Object.freeze({
      deploymentId: fixture.deploymentId,
      scopeId: fixture.scopeId,
      physicalLocator: LOCATOR,
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      lastCommitSeq: clock.lastCommitSeq,
      lastOutboxSeq: clock.lastOutboxSeq,
    });
    const prepared = await runEffect(prepareAppSchemaCandidateWriteGuardEffect(
      guard,
      { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId },
    ));
    const validDocument = await canonicalizeAppDocumentV1({
      tableId: fixture.tableId,
      rowId: rowId(1),
      creationTime: decodeAppCreationTimeV1(1_750_000_000_000),
      fields: { name: "valid" },
    });
    await expect(fixture.persistence.drizzle.transaction(tx =>
      runEffect(applyAppSchemaCandidateWriteGuardInTransactionEffect(
        tx,
        guard,
        prepared,
        authority,
        clock,
        CommitSeqSchema.make(1n),
        Object.freeze([Object.freeze({
          tableId: fixture.tableId,
          rowId: rowId(1),
          document: validDocument,
        })]),
      ))
    )).resolves.toEqual({ status: "unchanged" });
    await expect(fixture.persistence.drizzle.transaction(tx =>
      runEffect(applyAppSchemaCandidateWriteGuardInTransactionEffect(
        tx,
        guard,
        prepared,
        authority,
        clock,
        CommitSeqSchema.make(1n),
        Object.freeze([]),
      ))
    )).resolves.toEqual({ status: "unchanged" });
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      head: { frameSha256Hex: progressSha },
    });

    await advance(fixture, fixture.schemaVersionId);
    await runEffect(settleAppSchemaCandidateValidationEffect(
      candidateValidation,
      input(fixture, fixture.schemaVersionId),
    ));
    const receiptEvidence = await runEffect(
      prepareAppSchemaCandidateWriteGuardEffect(guard, {
        deploymentId: fixture.deploymentId,
        scopeId: fixture.scopeId,
      }),
    );
    const invalidDocument = await canonicalizeAppDocumentV1({
      tableId: fixture.tableId,
      rowId: rowId(2),
      creationTime: decodeAppCreationTimeV1(1_750_000_000_001),
      fields: { name: 42 },
    });
    await expect(fixture.persistence.drizzle.transaction(tx =>
      runEffect(applyAppSchemaCandidateWriteGuardInTransactionEffect(
        tx,
        guard,
        receiptEvidence,
        authority,
        clock,
        CommitSeqSchema.make(1n),
        Object.freeze([Object.freeze({
          tableId: fixture.tableId,
          rowId: rowId(2),
          document: invalidDocument,
        })]),
      ))
    )).resolves.toEqual({ status: "candidateFailed" });
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      head: { frame: {
        kind: "app_schema_candidate_validation_failure_evidence",
        entries: [{ source: "pointCommit", observedCommitSeq: 1n }],
      } },
    });
  });

  it("binds write guards to one exact point-commit authority object", async () => {
    const fixture = await fixtureFor("write_guard_composition");
    const dependencies = portDependencies(fixture);
    const pointCommitAuthority = Object.freeze({
      scopeMetadata: dependencies.authority.scopeMetadata,
      provisioningReceipts: dependencies.authority.provisioningReceipts,
      scopeSessionTargets: dependencies.authority.scopeClockTargets,
    });
    const candidateValidation = createAppSchemaCandidateValidationPort(
      dependencies,
    );
    const guard = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority,
    });
    expect(hasAppSchemaCandidateWriteGuardComposition(
      guard,
      pointCommitAuthority,
    )).toBe(true);
    expect(hasAppSchemaCandidateWriteGuardComposition(
      { ...guard },
      pointCommitAuthority,
    )).toBe(false);
    expect(hasAppSchemaCandidateWriteGuardComposition(
      guard,
      { ...pointCommitAuthority },
    )).toBe(false);

    const applicationPointCommitAuthority = Object.freeze({
      ...pointCommitAuthority,
      applicationControlDb: dependencies.controlDb,
    });
    const applicationGuard = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority: applicationPointCommitAuthority,
    });
    expect(hasAppSchemaCandidateWriteGuardComposition(
      applicationGuard,
      applicationPointCommitAuthority,
    )).toBe(true);
    expect(hasAppSchemaCandidateWriteGuardComposition(
      { ...applicationGuard },
      applicationPointCommitAuthority,
    )).toBe(false);
    expect(hasAppSchemaCandidateWriteGuardComposition(
      applicationGuard,
      { ...applicationPointCommitAuthority },
    )).toBe(false);

    const foreignFixture = await fixtureFor("write_guard_foreign_control");
    const foreignControlAuthority = Object.freeze({
      ...pointCommitAuthority,
      applicationControlDb: foreignFixture.persistence.drizzle,
    });
    const foreignControlGuard = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority: foreignControlAuthority,
    });
    expect(hasAppSchemaCandidateWriteGuardComposition(
      foreignControlGuard,
      foreignControlAuthority,
    )).toBe(false);
    await expect(runEffectFailure(prepareAppSchemaCandidateWriteGuardEffect(
      foreignControlGuard,
      { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId },
    ))).resolves.toMatchObject({
      _tag: "AppSchemaCandidateWriteGuardError",
      reason: "notIssued",
    });

    let getterReads = 0;
    const accessorAuthority = Object.defineProperties({}, {
      scopeMetadata: {
        enumerable: true,
        get: () => {
          getterReads += 1;
          return pointCommitAuthority.scopeMetadata;
        },
      },
      provisioningReceipts: {
        enumerable: true,
        value: pointCommitAuthority.provisioningReceipts,
      },
      scopeSessionTargets: {
        enumerable: true,
        value: pointCommitAuthority.scopeSessionTargets,
      },
    }) as typeof pointCommitAuthority;
    const unissued = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority: accessorAuthority,
    });
    expect(getterReads).toBe(0);
    await expect(runEffectFailure(prepareAppSchemaCandidateWriteGuardEffect(
      unissued,
      { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId },
    ))).resolves.toMatchObject({
      _tag: "AppSchemaCandidateWriteGuardError",
      reason: "notIssued",
    });
  });

  it("accepts same-candidate scan progress between preparation and commit", async () => {
    const fixture = await fixtureFor("write_guard_progress_race");
    await appendLive(fixture, rowId(1), 1n, null, { name: "existing" });
    await setClockCommit(fixture, 1n);
    const dependencies = portDependencies(fixture);
    const candidateValidation = createAppSchemaCandidateValidationPort(
      dependencies,
    );
    const pointCommitAuthority = Object.freeze({
      scopeMetadata: dependencies.authority.scopeMetadata,
      provisioningReceipts: dependencies.authority.provisioningReceipts,
      scopeSessionTargets: dependencies.authority.scopeClockTargets,
    });
    const guard = createAppSchemaCandidateWriteGuardPort({
      candidateValidation,
      pointCommitAuthority,
    });
    await runEffect(installAppSchemaCandidateValidationEffect(
      candidateValidation,
      input(fixture, fixture.schemaVersionId),
    ));
    const prepared = await runEffect(prepareAppSchemaCandidateWriteGuardEffect(
      guard,
      { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId },
    ));
    await advance(fixture, fixture.schemaVersionId);
    const clock = await fixture.target.getCurrentClock(fixture.scopeId);
    if (clock === null) throw new Error("Missing scope clock.");
    const authority = Object.freeze({
      deploymentId: fixture.deploymentId,
      scopeId: fixture.scopeId,
      physicalLocator: LOCATOR,
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      lastCommitSeq: clock.lastCommitSeq,
      lastOutboxSeq: clock.lastOutboxSeq,
    });
    const invalid = await canonicalizeAppDocumentV1({
      tableId: fixture.tableId,
      rowId: rowId(2),
      creationTime: decodeAppCreationTimeV1(1_750_000_000_001),
      fields: { name: 42 },
    });
    await expect(fixture.persistence.drizzle.transaction(tx =>
      runEffect(applyAppSchemaCandidateWriteGuardInTransactionEffect(
        tx,
        guard,
        prepared,
        authority,
        clock,
        CommitSeqSchema.make(2n),
        Object.freeze([Object.freeze({
          tableId: fixture.tableId,
          rowId: rowId(2),
          document: invalid,
        })]),
      ))
    )).resolves.toEqual({ status: "candidateFailed" });
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      head: { frame: {
        kind: "app_schema_candidate_validation_failure_evidence",
        entries: [{ source: "pointCommit", observedCommitSeq: 2n }],
      } },
    });
  });

  it("truncates long-path failures to the aggregate evidence byte ceiling", async () => {
    const fixture = await fixtureFor("failure_bytes");
    const installed = await install(fixture, fixture.schemaVersionId);
    if (installed.head.frame.kind !==
        "app_schema_candidate_validation_progress") {
      throw new Error("Expected installed progress frame.");
    }
    const failures = Object.freeze(Array.from({ length: 16 }, (_, index) =>
      Object.freeze({
        tableId: fixture.tableId,
        rowId: rowId(index + 1),
        observedCommitSeq: CommitSeqSchema.make(1n),
        source: "pointCommit" as const,
        reason: "candidateValidatorRejected" as const,
        validatorPath: `$document.${"x".repeat(3_980)}`,
      })
    ));
    const canonical = await runEffect(
      canonicalizeBoundedFailureEvidenceFrameEffect(
        installed.head.frame,
        installed.head.frameSha256Hex,
        BigInt(failures.length),
        failures,
      ),
    );
    expect(canonical.frame).toMatchObject({
      kind: "app_schema_candidate_validation_failure_evidence",
      observedFailureCount: 16n,
      truncated: true,
    });
    expect(canonical.frame.entries.length).toBeGreaterThan(0);
    expect(canonical.frame.entries.length).toBeLessThan(16);
    expect(canonical.frame.entries[0]?.validatorPath?.length)
      .toBeGreaterThan(3_000);
    expect(canonical.canonicalBytes.byteLength)
      .toBeLessThanOrEqual(
        MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1,
      );
    await expect(runEffectFailure(
      canonicalizeBoundedFailureEvidenceFrameEffect(
        installed.head.frame,
        installed.head.frameSha256Hex,
        17n,
        Object.freeze([
          ...failures,
          Object.freeze({
            tableId: fixture.tableId,
            rowId: rowId(17),
            observedCommitSeq: CommitSeqSchema.make(1n),
            source: "pointCommit" as const,
            reason: "candidateValidatorRejected" as const,
            validatorPath: `$document.${"x".repeat(3_980)}`,
          }),
        ]),
      ),
    )).resolves.toMatchObject({ operation: "advance", reason: "corruption" });
  });

  it("rolls back interrupted progress and rejects canonical-frame corruption", async () => {
    const fixture = await fixtureFor("rollback");
    await appendLive(fixture, rowId(1), 1n, null, { name: "safe" });
    await setClockCommit(fixture, 1n);
    const installed = await install(fixture, fixture.schemaVersionId);
    const failure = await runEffectFailure(
      advanceAppSchemaCandidateValidationEffect(
        port(fixture),
        input(fixture, fixture.schemaVersionId),
        { faultAfter: () => { throw new Error("rollback"); } },
      ),
    );
    expect(failure).toBeInstanceOf(AppSchemaCandidateValidationOperationV1Error);
    expect(failure).toMatchObject({ reason: "rollbackConfirmed" });
    const afterRollback = await load(fixture, fixture.schemaVersionId);
    expect(afterRollback).toMatchObject({
      status: "present",
      head: {
        frameSha256Hex: installed.head.frameSha256Hex,
        frame: { progressSequence: 0n, cursor: null },
      },
    });

    await fixture.persistence.query(
      `update fx_system_app_schema_candidate_validation
          set frame_bytes = set_byte(
            frame_bytes,
            0,
            (get_byte(frame_bytes, 0) + 1) % 256
          )
        where scope_id = $1`,
      [fixture.scopeId],
    );
    await expect(runEffectFailure(loadAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({
      reason: "corruption",
    });
  });

  it("projects decision uncertainty and cold-replays the committed head", async () => {
    const fixture = await fixtureFor("uncertain");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.persistence.drizzle,
    );
    let injected = false;
    const uncertainTarget = createLocatedAppSchemaCandidateValidationTarget(
      fixture.persistence.drizzle,
      LOCATOR,
      async work => {
        const result = await baseRunner(work);
        if (!injected) {
          injected = true;
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost candidate-validation response"),
          }));
        }
        return result;
      },
    );
    const failure = await runEffectFailure(
      installAppSchemaCandidateValidationEffect(
        port(fixture, uncertainTarget),
        input(fixture, fixture.schemaVersionId),
      ),
    );
    expect(injected).toBe(true);
    expect(failure).toMatchObject({
      _tag: "AppSchemaCandidateValidationOperationV1Error",
      operation: "install",
      reason: "decisionUncertain",
    });
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      status: "present",
      head: { frame: { attemptFence: 1n, progressSequence: 0n } },
    });
    await expect(install(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "replayed",
      head: { frame: { attemptFence: 1n, progressSequence: 0n } },
    });
  });

  it("advances resumably at the time ceiling without losing cursor order", async () => {
    const fixture = await fixtureFor("time_budget");
    await appendLive(fixture, rowId(1), 1n, null, { name: "Ada" });
    await appendLive(fixture, rowId(2), 1n, null, { name: "Bea" });
    await setClockCommit(fixture, 1n);
    await install(fixture, fixture.schemaVersionId);
    let clockReads = 0;
    const first = await runEffect(advanceAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
      {
        monotonicNow: Effect.sync(() =>
          clockReads++ === 0 ? 0n : 5_000_000_000n
        ),
      },
    ));
    expect(first).toMatchObject({
      disposition: "advanced",
      processedIdentities: 1,
      validatedRows: 1,
      head: { frame: {
        progressSequence: 1n,
        validatedRowCount: 1n,
        cursor: { afterRowId: rowId(1) },
      } },
    });
    const second = await advance(fixture, fixture.schemaVersionId);
    expect(second).toMatchObject({
      disposition: "readyToSettle",
      processedIdentities: 1,
      validatedRows: 1,
      head: { frame: {
        progressSequence: 2n,
        validatedRowCount: 2n,
        cursor: { afterRowId: "f".repeat(32) },
      } },
    });
  });

  it("caps one page at 128 identities and resumes the 129th exactly", async () => {
    const fixture = await fixtureFor("row_budget");
    await appendManyLive(fixture, 129);
    await setClockCommit(fixture, 1n);
    await install(fixture, fixture.schemaVersionId);
    const first = await advance(fixture, fixture.schemaVersionId);
    expect(first).toMatchObject({
      disposition: "advanced",
      processedIdentities: 128,
      validatedRows: 128,
      head: { frame: {
        validatedRowCount: 128n,
        validatedPageCount: 1n,
        cursor: { afterRowId: rowId(128) },
      } },
    });
    const second = await advance(fixture, fixture.schemaVersionId);
    expect(second).toMatchObject({
      disposition: "readyToSettle",
      processedIdentities: 1,
      validatedRows: 1,
      head: { frame: {
        validatedRowCount: 129n,
        validatedPageCount: 2n,
        cursor: { afterRowId: "f".repeat(32) },
      } },
    });
  }, 180_000);

  it("lets DDL guards refuse malformed authority without changing the head", async () => {
    const fixture = await fixtureFor("ddl_refusal");
    const installed = await install(fixture, fixture.schemaVersionId);
    await expect(fixture.persistence.query(
      `update fx_system_app_schema_candidate_validation
          set frame_byte_length = 0
        where scope_id = $1`,
      [fixture.scopeId],
    )).rejects.toThrow();
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      status: "present",
      head: {
        frameSha256Hex: installed.head.frameSha256Hex,
        frame: { attemptFence: 1n, progressSequence: 0n },
      },
    });
    const columns = await fixture.persistence.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_app_schema_candidate_validation'
        order by ordinal_position`,
    );
    expect(columns.rows.map(row => row.column_name)).not.toEqual(
      expect.arrayContaining(["document", "document_json", "source_bytes"]),
    );
  });

  it("restarts a remediated failed candidate at a fresh frontier", async () => {
    const fixture = await fixtureFor("restart_failed");
    await appendLive(fixture, rowId(1), 1n, null, { name: 42 });
    await setClockCommit(fixture, 1n);
    await install(fixture, fixture.schemaVersionId);
    await expect(advance(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "failed",
      head: { frame: { attemptFence: 1n } },
    });
    await expect(install(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "replayed",
      head: { frame: {
        kind: "app_schema_candidate_validation_failure_evidence",
        frontierCommitSeq: 1n,
        attemptFence: 1n,
      } },
    });

    await appendLive(fixture, rowId(1), 2n, 1n, { name: "repaired" });
    await setClockCommit(fixture, 2n);
    await expect(install(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "restarted",
      head: { frame: {
        kind: "app_schema_candidate_validation_progress",
        frontierCommitSeq: 2n,
        attemptFence: 2n,
        progressSequence: 0n,
      } },
    });
    await expect(advance(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "readyToSettle",
      validatedRows: 1,
      head: { frame: { validatedRowCount: 1n } },
    });
    await expect(runEffect(settleAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({
      frame: { kind: "app_schema_candidate_validation_receipt", attemptFence: 2n },
    });
  });

  it("boundedly skips more than one page of post-frontier inserts", async () => {
    const fixture = await fixtureFor("post_frontier");
    await install(fixture, fixture.schemaVersionId);
    await appendManyLive(fixture, 129);
    await setClockCommit(fixture, 1n);
    await expect(advance(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "advanced",
      processedIdentities: 128,
      validatedRows: 0,
    });
    await expect(advance(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      disposition: "readyToSettle",
      processedIdentities: 1,
      validatedRows: 0,
    });
    await expect(runEffect(settleAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({
      frame: {
        kind: "app_schema_candidate_validation_receipt",
        frontierCommitSeq: 0n,
        settlementCommitSeq: 1n,
        validatedRowCount: 0n,
      },
    });
  });

  it("rejects a current identity whose revision history has no root", async () => {
    const fixture = await fixtureFor("missing_root");
    const id = rowId(1);
    await fixture.persistence.query(
      `insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
         write_epoch_uuid, schema_version_id, creation_time,
         value_codec_version, is_tombstone, value_json, value_bytes,
         value_sha256)
       select scope_uuid, $2, decode($3, 'hex'), 2, 1, epoch_uuid, $4,
         1750000000000, 1, true, null, null, null
       from fx_system_scope_clock
       where scope_id = $1`,
      [fixture.scopeId, fixture.tableId, id, fixture.schemaVersionId],
    );
    await fixture.persistence.query(
      `insert into fx_app_row_current
        (scope_uuid, table_id, row_id, commit_seq)
       select scope_uuid, $2, decode($3, 'hex'), 2
       from fx_system_scope_clock
       where scope_id = $1`,
      [fixture.scopeId, fixture.tableId, id],
    );
    await setClockCommit(fixture, 2n);
    const installed = await install(fixture, fixture.schemaVersionId);
    await expect(runEffectFailure(advanceAppSchemaCandidateValidationEffect(
      port(fixture),
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({ operation: "advance", reason: "corruption" });
    await expect(load(fixture, fixture.schemaVersionId)).resolves.toMatchObject({
      status: "present",
      head: {
        frameSha256Hex: installed.head.frameSha256Hex,
        frame: { progressSequence: 0n, cursor: null },
      },
    });
  });

  it("authenticates exact port composition and rejects copies and accessors", async () => {
    const fixture = await fixtureFor("port_auth");
    const exactDependencies = portDependencies(fixture);
    const exact = createAppSchemaCandidateValidationPort(exactDependencies);
    expect(hasAppSchemaCandidateValidationComposition(
      exact,
      exactDependencies.controlDb,
      exactDependencies.authority,
    )).toBe(true);
    expect(hasAppSchemaCandidateValidationComposition(
      exact,
      exactDependencies.controlDb,
      { ...exactDependencies.authority },
    )).toBe(false);

    const copied = { ...exact } as typeof exact;
    await expect(runEffectFailure(installAppSchemaCandidateValidationEffect(
      copied,
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({ operation: "install", reason: "corruption" });

    let getterReads = 0;
    const accessorDependencies = Object.defineProperties({}, {
      controlDb: {
        enumerable: true,
        get: () => {
          getterReads += 1;
          return exactDependencies.controlDb;
        },
      },
      authority: {
        enumerable: true,
        value: exactDependencies.authority,
      },
    }) as typeof exactDependencies;
    const accessor = createAppSchemaCandidateValidationPort(
      accessorDependencies,
    );
    expect(getterReads).toBe(0);
    await expect(runEffectFailure(installAppSchemaCandidateValidationEffect(
      accessor,
      input(fixture, fixture.schemaVersionId),
    ))).resolves.toMatchObject({ operation: "install", reason: "corruption" });
  });
});

type Persistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface Fixture {
  readonly persistence: Persistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly schemaManifestSha256Hex: ReturnType<
    typeof appSchemaCandidateManifestSha256HexV1FromBytes
  >;
  readonly replacementSchemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly replacementSchemaManifestSha256Hex: ReturnType<
    typeof appSchemaCandidateManifestSha256HexV1FromBytes
  >;
  readonly emptySchemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly tableId: CatalogTableId;
  readonly secondaryTableId: CatalogTableId;
  readonly target: ReturnType<typeof createLocatedAppSchemaCandidateValidationTarget>;
}

async function fixtureFor(suffix: string): Promise<Fixture> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  fixtureOrdinal += 1;
  const fixtureSuffix = fixtureOrdinal.toString(16).padStart(12, "0");
  const deploymentId = `deployment_schema_validation_${suffix}`;
  const scopeId = ScopeIdSchema.make(
    `scope_81000000-0000-4000-8000-${fixtureSuffix}`,
  );
  const epoch = ScopeEpochSchema.make(
    `epoch_82000000-0000-4000-8000-${fixtureSuffix}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_validation_${suffix}_a`,
  );
  const replacementSchemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_validation_${suffix}_b`,
  );
  const emptySchemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_validation_${suffix}_empty`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_schema_validation_${suffix}`,
  });
  await persistence.insertScopeMetadata({ scopeId, deploymentId, physicalLocator: LOCATOR });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
  const first = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("recipes", false), appTable("ingredients", false)],
    indexes: [],
  });
  const replacement = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId: replacementSchemaVersionId,
    version: CatalogSchemaVersionSchema.make(2),
    tables: [appTable("recipes", true), appTable("ingredients", true)],
    indexes: [],
  });
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId: emptySchemaVersionId,
    version: CatalogSchemaVersionSchema.make(3),
    tables: [],
    indexes: [],
  });
  const table = first.manifest.tableDefinitions.tables[0];
  const secondaryTable = first.manifest.tableDefinitions.tables[1];
  if (table === undefined) throw new Error("Missing recipes table.");
  if (secondaryTable === undefined) throw new Error("Missing ingredients table.");
  return Object.freeze({
    persistence,
    deploymentId,
    scopeId,
    epoch,
    schemaVersionId,
    schemaManifestSha256Hex:
      appSchemaCandidateManifestSha256HexV1FromBytes(
        first.artifact.manifestSha256,
      ),
    replacementSchemaVersionId,
    replacementSchemaManifestSha256Hex:
      appSchemaCandidateManifestSha256HexV1FromBytes(
        replacement.artifact.manifestSha256,
      ),
    emptySchemaVersionId,
    tableId: table.tableId,
    secondaryTableId: secondaryTable.tableId,
    target: createLocatedAppSchemaCandidateValidationTarget(
      persistence.drizzle,
      LOCATOR,
    ),
  });
}

function port(
  fixture: Fixture,
  target: Fixture["target"] = fixture.target,
) {
  return createAppSchemaCandidateValidationPort(
    portDependencies(fixture, target),
  );
}

function portDependencies(
  fixture: Fixture,
  target: Fixture["target"] = fixture.target,
) {
  return {
    controlDb: fixture.persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          fixture.persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
  } as const;
}

function input(
  fixture: Fixture,
  schemaVersionId: Fixture["schemaVersionId"],
) {
  return Object.freeze({ deploymentId: fixture.deploymentId, schemaVersionId });
}

function readinessInput(
  fixture: Fixture,
  schemaVersionId: Fixture["schemaVersionId"],
  schemaManifestSha256Hex: Fixture["schemaManifestSha256Hex"],
) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    scopeId: fixture.scopeId,
    schemaVersionId,
    schemaManifestSha256Hex,
  });
}

function install(fixture: Fixture, schemaVersionId: Fixture["schemaVersionId"]) {
  return runEffect(installAppSchemaCandidateValidationEffect(
    port(fixture),
    input(fixture, schemaVersionId),
  ));
}

function advance(fixture: Fixture, schemaVersionId: Fixture["schemaVersionId"]) {
  return runEffect(advanceAppSchemaCandidateValidationEffect(
    port(fixture),
    input(fixture, schemaVersionId),
  ));
}

function load(fixture: Fixture, schemaVersionId: Fixture["schemaVersionId"]) {
  return runEffect(loadAppSchemaCandidateValidationEffect(
    port(fixture),
    input(fixture, schemaVersionId),
  ));
}

async function appendLive(
  fixture: Fixture,
  id: AppRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  fields: Readonly<Record<string, unknown>>,
) {
  const creationTime = decodeAppCreationTimeV1(1_750_000_000_000);
  const document = await canonicalizeAppDocumentV1({
    tableId: fixture.tableId,
    rowId: id,
    creationTime,
    fields,
  });
  await fixture.persistence.drizzle.transaction(async tx => {
    Result.getOrThrow(
      await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          kind: "live",
          scopeId: fixture.scopeId,
          tableId: fixture.tableId,
          rowId: id,
          writeEpoch: fixture.epoch,
          commitSeq: CommitSeqSchema.make(commitSeq),
          prevCommitSeq: prevCommitSeq === null
            ? null
            : CommitSeqSchema.make(prevCommitSeq),
          schemaVersionId: fixture.schemaVersionId,
          creationTime,
          document,
        },
      ),
    );
  });
}

async function appendManyLive(fixture: Fixture, count: number) {
  const creationTime = decodeAppCreationTimeV1(1_750_000_000_000);
  const documents = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const id = rowId(index + 1);
    return Object.freeze({
      id,
      document: await canonicalizeAppDocumentV1({
        tableId: fixture.tableId,
        rowId: id,
        creationTime,
        fields: { name: `recipe-${index + 1}` },
      }),
    });
  }));
  await fixture.persistence.drizzle.transaction(async tx => {
    for (const { id, document } of documents) {
      Result.getOrThrow(
        await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
          tx,
          {
            kind: "live",
            scopeId: fixture.scopeId,
            tableId: fixture.tableId,
            rowId: id,
            writeEpoch: fixture.epoch,
            commitSeq: CommitSeqSchema.make(1n),
            prevCommitSeq: null,
            schemaVersionId: fixture.schemaVersionId,
            creationTime,
            document,
          },
        ),
      );
    }
  });
}

function setClockCommit(fixture: Fixture, commitSeq: bigint) {
  return fixture.persistence.query(
    "update fx_system_scope_clock set last_commit_seq = $2 where scope_id = $1",
    [fixture.scopeId, commitSeq.toString()],
  );
}

function rowId(value: number): AppRowIdHexV1 {
  return decodeAppRowIdHexV1(value.toString(16).padStart(32, "0"));
}

function appTable(
  logicalName: string,
  optionalDescription: boolean,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: { fieldType: { type: "string" }, optional: false },
          ...(optionalDescription
            ? { description: { fieldType: { type: "string" }, optional: true } }
            : {}),
        },
      },
    },
  };
}
