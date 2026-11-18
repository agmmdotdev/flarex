import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { CatalogTableIdSchema, CatalogUniqueConstraintDefinitionIdSchema, CatalogUniqueConstraintIdSchema } from "flarex-protocol/catalog";
import { AppUniqueConstraintSpecSha256HexV1Schema } from "flarex-protocol/app-unique-constraint-definition";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { AppUniqueConstraintSetBuildAttemptFenceV1Schema } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { decodeUniqueBuildStateEffect } from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { decodeUniqueMaintenanceObligationEffect } from "../../../src/storage/indexes/indexMaintenanceModel";

const scopeId = ScopeIdSchema.make("scope_87000000-0000-0000-0000-000000000001");
const definitionId = CatalogUniqueConstraintDefinitionIdSchema.make(1);
const schemaVersionId = CatalogSchemaVersionIdSchema.make("schema_unique_acceptance");
const tableId = CatalogTableIdSchema.make(1);
const snapshot = { schemaVersionId, members: [{ logicalUniqueConstraintId: CatalogUniqueConstraintIdSchema.make(1),
  uniqueConstraintDefinitionId: definitionId, tableId,
  physicalSpecSha256Hex: AppUniqueConstraintSpecSha256HexV1Schema.make("00".repeat(32)) }] };
const authority = { scopeId };
const base = { scopeId, uniqueConstraintDefinitionId: definitionId, startCommitSeq: CommitSeqSchema.make(1n),
  coveredThroughCommitSeq: CommitSeqSchema.make(2n), maintenanceActivationSequence: null, maintenanceAuthorityKind: null, maintenanceObligation: null,
  attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(1n), storageGeneration: "flarexdb_v1" as const,
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
  epoch: ScopeEpochSchema.make("epoch_87000000-0000-0000-0000-000000000002"), lifecycle: "enabled" as const,
  cursorRowId: null, createdAt: new Date(1), updatedAt: new Date(2) };
const maintenance = { authorityKind: "application" as const, candidateSha256: null, schemaManifestSha256: null, scopeId, activationSequence: 3n, storageGeneration: base.storageGeneration,
  storageGenerationFence: base.storageGenerationFence, epoch: base.epoch, openedCommitSeq: base.coveredThroughCommitSeq,
  tableId, physicalSpecSha256: new Uint8Array(32), deploymentId: "deployment_unique_acceptance", schemaVersionId,
  activationSha256: new Uint8Array(32), headSha256: new Uint8Array(32),
  uniqueConstraintDefinitionId: definitionId, attemptFence: base.attemptFence, startCommitSeq: base.startCommitSeq };

describe("ordered unique build acceptance", () => {
  it("keeps Application and binding openings distinct at the same sequence and detaches binding pins", () => {
    const binding = { ...maintenance, authorityKind: "binding" as const,
      candidateSha256: new Uint8Array(32), schemaManifestSha256: new Uint8Array(32) };
    const valid = Effect.runSync(decodeUniqueBuildStateEffect(authority, snapshot,
      { ...base, maintenanceAuthorityKind: "binding", maintenanceActivationSequence: 3n, maintenanceObligation: binding }, 2n));
    expect(valid.maintenance?.authorityKind).toBe("binding");
    expect(valid.maintenance?.candidateSha256).not.toBe(binding.candidateSha256);
    expect(Effect.runSync(Effect.result(decodeUniqueBuildStateEffect(authority, snapshot,
      { ...base, maintenanceAuthorityKind: "application", maintenanceActivationSequence: 3n, maintenanceObligation: binding }, 2n))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedStateInvalid", cause: "Maintenance obligation does not match build state" } });
  });

  it("keeps structural and lifecycle refusal ahead of frontier and maintenance refusal", () => {
    expect(Effect.runSync(Effect.result(decodeUniqueBuildStateEffect(authority, snapshot, { ...base, attemptFence: 0n,
      coveredThroughCommitSeq: 4n, maintenanceObligation: {} }, 2n)))).toMatchObject({
      _tag: "Failure", failure: { reason: "storedStateInvalid", cause: { _tag: "SchemaError" } } });
    expect(Effect.runSync(Effect.result(decodeUniqueBuildStateEffect(authority, snapshot, { ...base, updatedAt: new Date(0),
      coveredThroughCommitSeq: 4n, maintenanceObligation: {} }, 2n)))).toMatchObject({
      _tag: "Failure", failure: { reason: "storedStateInvalid", cause: undefined } });
    expect(Effect.runSync(Effect.result(decodeUniqueBuildStateEffect(authority, snapshot, { ...base, coveredThroughCommitSeq: 4n,
      maintenanceObligation: {} }, 2n)))).toMatchObject({ _tag: "Failure", failure: { reason: "frontierAheadOfClock" } });
    expect(Effect.runSync(Effect.result(decodeUniqueBuildStateEffect(authority, snapshot, { ...base, maintenanceActivationSequence: 3n, maintenanceAuthorityKind: "application",
      maintenanceObligation: { ...maintenance, attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(2n) } }, 2n))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedStateInvalid", cause: "Maintenance obligation does not match build state" } });
  });

  it("detaches mutable cursor and maintenance bytes without issuing readiness", () => {
    const cursor = new Uint8Array(16);
    const state = Effect.runSync(decodeUniqueBuildStateEffect(authority, snapshot,
      { ...base, lifecycle: "backfilling", cursorRowId: cursor }, 2n));
    expect(Object.isFrozen(state)).toBe(true);
    expect(state.cursorRowId).not.toBe(cursor);
    cursor[0] = 9;
    expect(state.cursorRowId?.[0]).toBe(0);
    const maintained = Effect.runSync(decodeUniqueBuildStateEffect(authority, snapshot,
      { ...base, maintenanceActivationSequence: 3n, maintenanceAuthorityKind: "application", maintenanceObligation: maintenance }, 2n));
    expect(Object.isFrozen(maintained.maintenance)).toBe(true);
    expect(maintained.maintenance?.physicalSpecSha256).not.toBe(maintenance.physicalSpecSha256);
    maintenance.physicalSpecSha256[0] = 8;
    expect(maintained.maintenance?.physicalSpecSha256[0]).toBe(0);
    expect("status" in maintained).toBe(false);
  });

  it("preserves raw row getter defects before intrinsic and frontier context", () => {
    const marker = new Error("unique raw row getter");
    let contextVisited = false;
    const row = Object.defineProperty({ ...base }, "scopeId", { get(): never { throw marker; } });
    const guardedAuthority = { get scopeId() { contextVisited = true; return scopeId; } };
    const exit = Effect.runSyncExit(decodeUniqueBuildStateEffect(guardedAuthority, snapshot, row, 0n));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBe(marker);
    }
    expect(contextVisited).toBe(false);
  });

  it("preserves outer maintenance capture before frontier refusal and nested raw decoder defects", () => {
    const marker = new Error("unique maintenance raw getter");
    const row = Object.defineProperty({ ...maintenance }, "activationSequence", { enumerable: true, get(): never { throw marker; } });
    const expectGetterDefect = <A, E>(work: Effect.Effect<A, E>) => {
      const exit = Effect.runSyncExit(work);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(Cause.squash(exit.cause)).toBe(marker);
      }
    };
    expectGetterDefect(decodeUniqueBuildStateEffect(authority, snapshot,
      { ...base, coveredThroughCommitSeq: 4n, maintenanceObligation: row }, 2n));
    expectGetterDefect(decodeUniqueMaintenanceObligationEffect(row));
  });
});
