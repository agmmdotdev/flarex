import { describe, expect, it, vi } from "vitest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
} from "../src/pglite";
import {
  SplitScopeAuthorityProvisioningProtocolVersions,
  SplitScopeAuthorityProvisioningStates,
  type ReadySplitScopeAuthorityProvisioningReceipt,
  type SplitScopeAuthorityProvisioningReceipt,
} from "../src/scopeAuthorityProvisioningReceiptTypes";
import {
  resolveLocatedTrustedScopeAuthority,
  resolveTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError,
  TrustedScopeAuthorityResolutionError,
  type LocatedScopeClockReader,
  type TrustedScopeAuthorityResolutionFailure,
  type TrustedScopeAuthorityResolutionPorts,
} from "../src/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../src/scopeClock";
import type { ScopeMetadataRecord } from "../src/scopeMetadata";
import type {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

function resolveTrustedScopeAuthority(
  deploymentId: string,
  ports: TrustedScopeAuthorityResolutionPorts,
) {
  return runEffect(resolveTrustedScopeAuthorityEffect(deploymentId, ports));
}

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "shared-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const splitLocator = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "scope-primary",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;

const schemaSplitLocator = Object.freeze({
  kind: "schema_per_scope",
  databaseKey: "shared-primary",
  schemaName: "scope_schema",
}) satisfies SplitScopePhysicalLocator;

const otherSharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "shared-other",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const otherSplitLocator = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "scope-other",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;

const scopeId = ScopeIdSchema.make(
  "scope_20000000-0000-4000-8000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_20000000-0000-4000-8000-000000000002",
);
const initialEpoch = ScopeEpochSchema.make(
  "epoch_20000000-0000-4000-8000-000000000003",
);

describe("trusted scope authority resolution", () => {
  it("resolves a provisioned shared scope from PGlite authority rows", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "20000000-0000-4000-8000-000000000011",
          "20000000-0000-4000-8000-000000000012",
        ),
      },
    );
    const provisioned = await provisioner.ensure({
      deploymentId: "deployment_shared",
      projectId: "project_shared",
    });
    const provisioningReceiptRead = vi.fn(async (_scopeId: ScopeId) => {
      throw new Error("Shared scope resolution must not read split receipts.");
    });
    const targetClockRead = vi.fn((resolvedScopeId: ScopeId) =>
      persistence.getScopeClock(resolvedScopeId),
    );
    const targetResolution = vi.fn(
      async (_physicalLocator: ScopePhysicalLocator) =>
        ({
          physicalLocator: sharedLocator,
          getCurrentClock: targetClockRead,
        }) satisfies LocatedScopeClockReader,
    );

    const authority = await resolveTrustedScopeAuthority(
      "deployment_shared",
      {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: provisioningReceiptRead,
        },
        scopeClockTargets: { resolve: targetResolution },
      },
    );

    expect(authority).toEqual({
      deploymentId: provisioned.scope.deploymentId,
      scopeId: provisioned.scope.scopeId,
      physicalLocator: sharedLocator,
      storageGeneration: provisioned.clock.storageGeneration,
      storageGenerationFence: provisioned.clock.storageGenerationFence,
      epoch: provisioned.clock.epoch,
      lastCommitSeq: provisioned.clock.lastCommitSeq,
      lastOutboxSeq: provisioned.clock.lastOutboxSeq,
    });
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.physicalLocator)).toBe(true);
    expect(provisioningReceiptRead).not.toHaveBeenCalled();
    expect(targetResolution).toHaveBeenCalledExactlyOnceWith(sharedLocator);
    expect(targetClockRead)
      .toHaveBeenCalledExactlyOnceWith(provisioned.scope.scopeId);
  });

  it("rejects a shared clock target for a different persisted placement", async () => {
    const fixture = resolutionFixture({
      scope: sharedScopeMetadata(),
      targetLocator: otherSharedLocator,
    });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_shared", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeClockTargetPlacementMismatch",
      scopeId,
      expected: sharedLocator,
      actual: otherSharedLocator,
    });
    expect(fixture.getProvisioningReceipt).not.toHaveBeenCalled();
    expect(fixture.getTargetClock).not.toHaveBeenCalled();
  });

  it("resolves a ready split target and preserves its advanced clock", async () => {
    const advancedClock = scopeClock(scopeId, {
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(9n),
      lastCommitSeq: CommitSeqSchema.make(41n),
      lastOutboxSeq: OutboxSeqSchema.make(17n),
      epoch: ScopeEpochSchema.make(
        "epoch_20000000-0000-4000-8000-000000000099",
      ),
    });
    const fixture = resolutionFixture({ targetClock: advancedClock });

    const authority = await resolveTrustedScopeAuthority(
      "deployment_split",
      fixture.ports,
    );

    expect(authority).toMatchObject({
      deploymentId: "deployment_split",
      scopeId,
      physicalLocator: splitLocator,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9n,
      lastCommitSeq: 41n,
      lastOutboxSeq: 17n,
    });
    expect(fixture.resolveClockTarget)
      .toHaveBeenCalledExactlyOnceWith(splitLocator);
    expect(fixture.getTargetClock).toHaveBeenCalledExactlyOnceWith(scopeId);
  });

  it("resolves a ready schema-per-scope target", async () => {
    const fixture = resolutionFixture({
      scope: schemaPerScopeMetadata(),
      receipt: readyReceipt({ physicalLocator: schemaSplitLocator }),
      targetLocator: schemaSplitLocator,
    });

    const authority = await resolveTrustedScopeAuthority(
      "deployment_schema_split",
      fixture.ports,
    );

    expect(authority).toMatchObject({
      deploymentId: "deployment_schema_split",
      scopeId,
      physicalLocator: schemaSplitLocator,
      storageGeneration: "legacy_v1",
      storageGenerationFence: 1n,
    });
    expect(fixture.resolveClockTarget)
      .toHaveBeenCalledExactlyOnceWith(schemaSplitLocator);
    expect(fixture.getTargetClock).toHaveBeenCalledExactlyOnceWith(scopeId);
  });

  it("fails closed when deployment scope metadata is missing", async () => {
    const fixture = resolutionFixture({ scope: null });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_missing", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeMetadataMissing",
      deploymentId: "deployment_missing",
    });
    expect(fixture.getProvisioningReceipt).not.toHaveBeenCalled();
    expect(fixture.resolveClockTarget).not.toHaveBeenCalled();
  });

  it("rejects a scope returned for another deployment", async () => {
    const fixture = resolutionFixture();

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_other", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeDeploymentMismatch",
      deploymentId: "deployment_other",
      scopeId,
      actualDeploymentId: "deployment_split",
    });
    expect(fixture.getProvisioningReceipt).not.toHaveBeenCalled();
  });

  it("requires a ready split provisioning receipt before target access", async () => {
    const missing = resolutionFixture({ receipt: null });
    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", missing.ports),
      ),
    ).resolves.toEqual({
      reason: "splitProvisioningReceiptMissing",
      scopeId,
    });
    expect(missing.resolveClockTarget).not.toHaveBeenCalled();

    const reserved = resolutionFixture({ receipt: reservedReceipt() });
    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", reserved.ports),
      ),
    ).resolves.toEqual({
      reason: "splitProvisioningReceiptNotReady",
      scopeId,
      actualState: "reserved",
    });
    expect(reserved.resolveClockTarget).not.toHaveBeenCalled();
  });

  it("rejects split receipt identity and placement mismatches", async () => {
    const wrongScope = resolutionFixture({
      receipt: readyReceipt({ receiptScopeId: otherScopeId }),
    });
    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", wrongScope.ports),
      ),
    ).resolves.toEqual({
      reason: "splitProvisioningReceiptScopeMismatch",
      scopeId,
      actualScopeId: otherScopeId,
    });
    expect(wrongScope.resolveClockTarget).not.toHaveBeenCalled();

    const wrongPlacement = resolutionFixture({
      receipt: readyReceipt({ physicalLocator: otherSplitLocator }),
    });
    await expect(
      expectFailure(
        resolveTrustedScopeAuthority(
          "deployment_split",
          wrongPlacement.ports,
        ),
      ),
    ).resolves.toEqual({
      reason: "splitProvisioningReceiptPlacementMismatch",
      scopeId,
      expected: splitLocator,
      actual: otherSplitLocator,
    });
    expect(wrongPlacement.resolveClockTarget).not.toHaveBeenCalled();
  });

  it("wraps split target resolution failure without reading a clock", async () => {
    const resolutionCause = new Error("target registry unavailable");
    const fixture = resolutionFixture({ resolutionCause });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeClockTargetResolutionFailed",
      scopeId,
      physicalLocator: splitLocator,
      resolutionCause,
    });
    expect(fixture.getTargetClock).not.toHaveBeenCalled();
  });

  it("rejects a split target that resolves a different placement", async () => {
    const fixture = resolutionFixture({ targetLocator: otherSplitLocator });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeClockTargetPlacementMismatch",
      scopeId,
      expected: splitLocator,
      actual: otherSplitLocator,
    });
    expect(fixture.getTargetClock).not.toHaveBeenCalled();
  });

  it(
    "freezes the requested locator before an asynchronous resolver can mutate it",
    async () => {
      const fixture = resolutionFixture({
        targetLocator: otherSplitLocator,
        mutateRequestedDatabaseKey: otherSplitLocator.databaseKey,
      });

      await expect(
        expectFailure(
          resolveTrustedScopeAuthority("deployment_split", fixture.ports),
        ),
      ).resolves.toEqual({
        reason: "scopeClockTargetPlacementMismatch",
        scopeId,
        expected: splitLocator,
        actual: otherSplitLocator,
      });
      expect(fixture.requestedLocatorMutationSucceeded()).toBe(false);
      expect(fixture.getTargetClock).not.toHaveBeenCalled();
    },
  );

  it("captures scope identity before asynchronous target resolution", async () => {
    const mutableScope = splitScopeMetadata();
    const fixture = resolutionFixture({
      scope: mutableScope,
      mutateScopeDuringTargetResolution: {
        deploymentId: "deployment_other",
        scopeId: otherScopeId,
      },
    });

    const authority = await resolveTrustedScopeAuthority(
      "deployment_split",
      fixture.ports,
    );

    expect(fixture.scopeIdentityMutationSucceeded()).toEqual({
      deploymentId: true,
      scopeId: true,
    });
    expect(mutableScope).toMatchObject({
      deploymentId: "deployment_other",
      scopeId: otherScopeId,
    });
    expect(authority).toMatchObject({
      deploymentId: "deployment_split",
      scopeId,
      physicalLocator: splitLocator,
    });
    expect(fixture.getTargetClock).toHaveBeenCalledExactlyOnceWith(scopeId);
  });

  it("rejects an unsupported runtime target-locator discriminant", async () => {
    const malformedTargetLocator = {
      kind: "database_per_scope",
      databaseKey: "scope-primary",
      schemaName: "public",
    } satisfies SplitScopePhysicalLocator;
    expect(
      Reflect.set(malformedTargetLocator, "kind", "unsupported_scope"),
    ).toBe(true);
    const fixture = resolutionFixture({
      targetLocator: malformedTargetLocator,
    });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeClockTargetInvalid",
      scopeId,
      invalidReason: "locatorKindUnsupported",
    });
    expect(fixture.getTargetClock).not.toHaveBeenCalled();
  });

  it("never interprets a missing scope clock as legacy_v1", async () => {
    const fixture = resolutionFixture({ targetClock: null });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeClockMissing",
      scopeId,
      physicalLocator: splitLocator,
    });
  });

  it("rejects a located clock for another scope", async () => {
    const fixture = resolutionFixture({
      targetClock: scopeClock(otherScopeId),
    });

    await expect(
      expectFailure(
        resolveTrustedScopeAuthority("deployment_split", fixture.ports),
      ),
    ).resolves.toEqual({
      reason: "scopeClockScopeMismatch",
      scopeId,
      actualScopeId: otherScopeId,
      physicalLocator: splitLocator,
    });
  });

  it("maps a metadata-port rejection once at its foreign boundary", async () => {
    const cause = new Error("scope metadata transport unavailable");
    const fixture = resolutionFixture({ metadataCause: cause });

    const failure = await runEffectFailure(
      resolveTrustedScopeAuthorityEffect("deployment_split", fixture.ports),
    );

    expect(failure).toBeInstanceOf(TrustedScopeAuthorityPortError);
    expect(failure).toMatchObject({
      _tag: "TrustedScopeAuthorityPortError",
      operation: "scopeMetadataRead",
      cause,
    });
    expect(fixture.getProvisioningReceipt).not.toHaveBeenCalled();
    expect(fixture.resolveClockTarget).not.toHaveBeenCalled();
  });

  it("preserves the original rejection identity at the temporary Promise facade", async () => {
    const cause = new Error("legacy metadata rejection");
    const fixture = resolutionFixture({ metadataCause: cause });

    await expect(
      resolveLocatedTrustedScopeAuthority("deployment_split", fixture.ports),
    ).rejects.toBe(cause);
  });

  it("maps a split receipt-port rejection before target resolution", async () => {
    const cause = new Error("receipt store unavailable");
    const fixture = resolutionFixture({ receiptCause: cause });

    const failure = await runEffectFailure(
      resolveTrustedScopeAuthorityEffect("deployment_split", fixture.ports),
    );

    expect(failure).toMatchObject({
      _tag: "TrustedScopeAuthorityPortError",
      operation: "provisioningReceiptRead",
      cause,
    });
    expect(fixture.resolveClockTarget).not.toHaveBeenCalled();
  });

  it("maps a located clock-port rejection after exact target resolution", async () => {
    const cause = new Error("scope clock unavailable");
    const fixture = resolutionFixture({ clockCause: cause });

    const failure = await runEffectFailure(
      resolveTrustedScopeAuthorityEffect("deployment_split", fixture.ports),
    );

    expect(failure).toMatchObject({
      _tag: "TrustedScopeAuthorityPortError",
      operation: "scopeClockRead",
      cause,
    });
    expect(fixture.resolveClockTarget).toHaveBeenCalledOnce();
  });
});

interface ResolutionFixtureOptions {
  readonly scope?: ScopeMetadataRecord | null;
  readonly receipt?: SplitScopeAuthorityProvisioningReceipt | null;
  readonly targetClock?: ScopeClockRecord | null;
  readonly targetLocator?: ScopePhysicalLocator;
  readonly mutateRequestedDatabaseKey?: string;
  readonly mutateScopeDuringTargetResolution?: {
    readonly deploymentId: string;
    readonly scopeId: ScopeId;
  };
  readonly resolutionCause?: unknown;
  readonly metadataCause?: unknown;
  readonly receiptCause?: unknown;
  readonly clockCause?: unknown;
}

function resolutionFixture(options: ResolutionFixtureOptions = {}) {
  const scope =
    options.scope === undefined ? splitScopeMetadata() : options.scope;
  const receipt =
    options.receipt === undefined ? readyReceipt() : options.receipt;
  const targetClock =
    options.targetClock === undefined
      ? scopeClock(scopeId)
      : options.targetClock;
  const targetLocator =
    options.targetLocator ?? scope?.physicalLocator ?? splitLocator;
  const getScopeMetadataByDeploymentId = vi.fn(
    async (_deploymentId: string) => {
      if ("metadataCause" in options) {
        throw options.metadataCause;
      }
      return scope;
    },
  );
  const getProvisioningReceipt = vi.fn(async (_scopeId: ScopeId) => {
    if ("receiptCause" in options) {
      throw options.receiptCause;
    }
    return receipt;
  });
  const getTargetClock = vi.fn(async (_scopeId: ScopeId) => {
    if ("clockCause" in options) {
      throw options.clockCause;
    }
    return targetClock;
  });
  const target = {
    physicalLocator: targetLocator,
    getCurrentClock: getTargetClock,
  } satisfies LocatedScopeClockReader;
  let requestedLocatorMutationSucceeded: boolean | undefined;
  let scopeIdentityMutationSucceeded:
    | {
        readonly deploymentId: boolean;
        readonly scopeId: boolean;
      }
    | undefined;
  const resolveClockTarget = vi.fn(
    async (physicalLocator: ScopePhysicalLocator) => {
      if (options.mutateRequestedDatabaseKey !== undefined) {
        requestedLocatorMutationSucceeded = Reflect.set(
          physicalLocator,
          "databaseKey",
          options.mutateRequestedDatabaseKey,
        );
      }
      if (
        options.mutateScopeDuringTargetResolution !== undefined &&
        scope !== null
      ) {
        scopeIdentityMutationSucceeded = {
          deploymentId: Reflect.set(
            scope,
            "deploymentId",
            options.mutateScopeDuringTargetResolution.deploymentId,
          ),
          scopeId: Reflect.set(
            scope,
            "scopeId",
            options.mutateScopeDuringTargetResolution.scopeId,
          ),
        };
      }
      if ("resolutionCause" in options) {
        throw options.resolutionCause;
      }
      return target;
    },
  );
  const ports = {
    scopeMetadata: { getScopeMetadataByDeploymentId },
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: getProvisioningReceipt,
    },
    scopeClockTargets: { resolve: resolveClockTarget },
  } satisfies TrustedScopeAuthorityResolutionPorts;

  return {
    ports,
    getProvisioningReceipt,
    getTargetClock,
    resolveClockTarget,
    requestedLocatorMutationSucceeded: () =>
      requestedLocatorMutationSucceeded,
    scopeIdentityMutationSucceeded: () =>
      scopeIdentityMutationSucceeded,
  };
}

function sharedScopeMetadata(): ScopeMetadataRecord {
  return {
    scopeId,
    deploymentId: "deployment_shared",
    isolationKind: sharedLocator.kind,
    physicalLocator: sharedLocator,
    activeSchemaVersionId: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
  } satisfies ScopeMetadataRecord;
}

function splitScopeMetadata(): ScopeMetadataRecord {
  return {
    scopeId,
    deploymentId: "deployment_split",
    isolationKind: splitLocator.kind,
    physicalLocator: splitLocator,
    activeSchemaVersionId: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
  } satisfies ScopeMetadataRecord;
}

function schemaPerScopeMetadata(): ScopeMetadataRecord {
  return {
    scopeId,
    deploymentId: "deployment_schema_split",
    isolationKind: schemaSplitLocator.kind,
    physicalLocator: schemaSplitLocator,
    activeSchemaVersionId: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
  } satisfies ScopeMetadataRecord;
}

function scopeClock(
  resolvedScopeId: ScopeId,
  overrides: Partial<Omit<ScopeClockRecord, "scopeId">> = {},
): ScopeClockRecord {
  return {
    scopeId: resolvedScopeId,
    storageGeneration:
      LegacyV1StorageGenerationSchema.make("legacy_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    lastCommitSeq: CommitSeqSchema.make(0n),
    lastOutboxSeq: OutboxSeqSchema.make(0n),
    epoch: initialEpoch,
    updatedAt: new Date("2026-07-11T00:00:00.000Z"),
    ...overrides,
  } satisfies ScopeClockRecord;
}

function readyReceipt(
  options: {
    readonly receiptScopeId?: ScopeId;
    readonly physicalLocator?: SplitScopePhysicalLocator;
  } = {},
): ReadySplitScopeAuthorityProvisioningReceipt {
  return {
    scopeId: options.receiptScopeId ?? scopeId,
    protocolVersion: SplitScopeAuthorityProvisioningProtocolVersions.v1,
    state: SplitScopeAuthorityProvisioningStates.ready,
    physicalLocator: options.physicalLocator ?? splitLocator,
    initialEpoch,
    reservedAt: new Date("2026-07-11T00:00:00.000Z"),
    readyAt: new Date("2026-07-11T00:00:01.000Z"),
  } satisfies ReadySplitScopeAuthorityProvisioningReceipt;
}

function reservedReceipt(): SplitScopeAuthorityProvisioningReceipt {
  return {
    ...readyReceipt(),
    state: SplitScopeAuthorityProvisioningStates.reserved,
    readyAt: null,
  } satisfies SplitScopeAuthorityProvisioningReceipt;
}

async function expectFailure(
  result: Promise<unknown>,
): Promise<TrustedScopeAuthorityResolutionFailure> {
  try {
    await result;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TrustedScopeAuthorityResolutionError);
    if (!(error instanceof TrustedScopeAuthorityResolutionError)) {
      throw error;
    }
    return error.failure;
  }
  throw new Error("Expected trusted scope authority resolution to fail.");
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID sequence exhausted.");
    }
    return value;
  };
}
