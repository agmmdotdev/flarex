import { Schema } from "effect";
import { expect, expectTypeOf, it } from "vitest";
import { CatalogSchemaVersionIdSchema } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import {
  TransactionAttemptFenceSchema,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";

import type { StoredAttemptEvidenceLoaderPortV1 } from
  "../../executor/src/storedAttemptAuthentication";
import * as persistenceRoot from "../src";
import type {
  PointCommitFinishingTransitionCommandV1,
  PointCommitFinishingTransitionPortV1,
  PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import {
  StoredAttemptEvidencePersistenceV1Error,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptFinishingEvidenceLoaderV1,
  type StoredAttemptEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { pointCommitFinishingCommandFromStoredAttemptV1 } from
  "./pointCommitTransactionTestSupport";

export interface StoredAttemptEvidenceLoaderBoundaryScenario {
  readonly anchor: Readonly<{
    readonly sessionId: PointMutationSessionAnchorV1["sessionId"];
  }>;
  readonly loader: StoredAttemptEvidenceLoaderV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
}

export interface StoredAttemptEvidenceLoaderBoundaryHarness<
  Scenario extends StoredAttemptEvidenceLoaderBoundaryScenario,
> {
  readonly scenario: (
    label: string,
    options?: Readonly<{
      readonly afterRepeatableRead?: () => void | Promise<void>;
    }>,
  ) => Promise<Scenario>;
  readonly seal: (
    current: Scenario,
  ) => Promise<Readonly<{ readonly journalSha256Hex: string }>>;
  readonly timestamps: (
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ) => Promise<Readonly<Record<string, string>>>;
  readonly createForeignAuthorityFailureLoader: (
    cause: Error,
  ) => StoredAttemptEvidenceLoaderV1;
  readonly replaceWithInvalidApplicationAuthority: (
    current: Scenario,
    lifecycle: TransactionSessionLifecycleV1,
  ) => Promise<void>;
  readonly installExactApplicationAuthority: (
    current: Scenario,
  ) => Promise<Readonly<{ readonly sha256: Uint8Array }>>;
  readonly createFinishingTransitionPort: (
    options?: PointCommitTransactionProofOptionsV1,
  ) => PointCommitFinishingTransitionPortV1;
  readonly bytesToHex: (bytes: Uint8Array) => string;
}

export function registerStoredAttemptEvidenceLoaderBoundaryTests<
  Scenario extends StoredAttemptEvidenceLoaderBoundaryScenario,
>(
  harness: StoredAttemptEvidenceLoaderBoundaryHarness<Scenario>,
): void {
  it("loads running+sealed evidence through the test-only structural seam", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      "createStoredAttemptEvidenceLoaderV1" | "StoredAttemptEvidenceV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createStoredAttemptEvidenceLoaderV1" in persistenceRoot).toBe(
      false,
    );

    let afterRepeatableRead = false;
    const current = await harness.scenario("running_sealed", {
      afterRepeatableRead: () => {
        afterRepeatableRead = true;
      },
    });
    const envelope = await harness.seal(current);
    const before = await harness.timestamps(current.anchor.sessionId);

    const executorPort: StoredAttemptEvidenceLoaderPortV1 = current.loader;
    expectTypeOf(executorPort).toMatchTypeOf<
      StoredAttemptEvidenceLoaderPortV1
    >();
    const result = await runEffect(executorPort.loadEffect(current.authority));

    expect(afterRepeatableRead).toBe(true);
    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(result.evidence.session.lifecycle).toBe("running");
    expect(result.evidence.root.journalBytes.byteLength).toBeGreaterThan(0);
    expect(harness.bytesToHex(result.evidence.root.journalSha256)).toBe(
      envelope.journalSha256Hex,
    );
    expect(result.evidence.root.sealedFinalSyscallSequence).toBe(0n);
    expect(result.evidence.points).toEqual([]);
    expect(await harness.timestamps(current.anchor.sessionId)).toEqual(before);
  });

  it("maps foreign authority failures into the typed persistence channel", async () => {
    const current = await harness.scenario("typed_authority_failure");
    const cause = new Error("stored-attempt metadata unavailable");
    const loader = harness.createForeignAuthorityFailureLoader(cause);

    const failure = await runEffectFailure(
      loader.loadEffect(current.authority),
    );
    expect(failure).toBeInstanceOf(StoredAttemptEvidencePersistenceV1Error);
    expect(failure).toMatchObject({
      _tag: "StoredAttemptEvidencePersistenceV1Error",
      operation: "scopeMetadataRead",
      cause,
    });
    expect(failure.cause).toBe(cause);
  });

  it.each(["running", "committed", "aborted"] as const)(
    "returns typed corruption for an Application-authority %s session",
    async lifecycle => {
      const current = await harness.scenario(
        `application_authority_${lifecycle}`,
      );
      if (lifecycle === "running") await harness.seal(current);
      await harness.replaceWithInvalidApplicationAuthority(current, lifecycle);
      await expect(runEffect(current.loader.loadEffect(current.authority)))
        .resolves.toMatchObject({
          kind: "corrupt",
          reason: "sessionRecordInvalid",
        });
    },
  );

  it("loads an exact canonical Application-authority session", async () => {
    const current = await harness.scenario("application_authority_exact");
    await harness.seal(current);
    const installed = await harness.installExactApplicationAuthority(current);
    const loaded = await runEffect(current.loader.loadEffect(current.authority));
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(loaded.evidence.session.executionAuthorityGeneration).toBe(
      "application_v1",
    );
    if (loaded.evidence.session.executionAuthorityGeneration !== "application_v1") {
      throw new Error("Expected Application authority.");
    }
    expect(harness.bytesToHex(
      loaded.evidence.session.applicationExecutionAuthoritySha256,
    )).toBe(harness.bytesToHex(installed.sha256));
    expect(Object.isFrozen(
      loaded.evidence.session.applicationExecutionAuthorityJson,
    )).toBe(true);
    expect(Object.isFrozen(
      loaded.evidence.session.applicationExecutionAuthorityJson.runtimeTarget,
    )).toBe(true);
  });

  it("enters finishing only for the exact stored Application authority", async () => {
    const current = await harness.scenario("application_authority_finishing");
    await harness.seal(current);
    await harness.installExactApplicationAuthority(current);
    const loaded = await runEffect(current.loader.loadEffect(current.authority));
    if (loaded.kind !== "loaded") throw new Error("Expected loaded evidence.");
    const exact = await pointCommitFinishingCommandFromStoredAttemptV1(
      current.authority,
      loaded.evidence,
    );
    const port = harness.createFinishingTransitionPort();

    const wrongDigest = Object.freeze({
      ...exact,
      authorityPins: Object.freeze({
        ...exact.authorityPins,
        applicationExecutionAuthoritySha256: new Uint8Array(32).fill(0xff),
      }),
    });
    await expect(runEffectFailure(
      enterForgedFinishingCommand(port, wrongDigest),
    )).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const mixed = Object.freeze({
      ...exact,
      authorityPins: Object.freeze({
        ...exact.authorityPins,
        packageId: "legacy-substitution",
      }),
    });
    await expect(runEffectFailure(
      enterForgedFinishingCommand(port, mixed),
    )).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const unknownPins = Object.freeze({
      ...exact,
      authorityPins: Object.freeze({
        ...exact.authorityPins,
        executionAuthorityGeneration: "unknown_v1",
      }),
    });
    await expect(runEffectFailure(
      enterForgedFinishingCommand(port, unknownPins),
    )).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const unknownSession = Object.freeze({
      ...exact,
      session: Object.freeze({
        ...exact.session,
        executionAuthorityGeneration: "unknown_v1",
      }),
    });
    await expect(runEffectFailure(
      enterForgedFinishingCommand(port, unknownSession),
    )).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const callerOwnedDigest =
      exact.authorityPins.applicationExecutionAuthoritySha256;
    if (callerOwnedDigest === undefined) {
      throw new Error("Expected Application authority digest.");
    }
    const detachedPort = harness.createFinishingTransitionPort({
      afterTransactionStep: async ({ step }) => {
        if (step === "clockLocked") callerOwnedDigest.fill(0xee);
      },
    });
    await expect(runEffect(detachedPort.enterFinishing(exact))).resolves
      .toMatchObject({ kind: "transitioned" });
    expect(callerOwnedDigest).toEqual(new Uint8Array(32).fill(0xee));
  });
}

function enterForgedFinishingCommand(
  port: PointCommitFinishingTransitionPortV1,
  command: unknown,
): ReturnType<PointCommitFinishingTransitionPortV1["enterFinishing"]> {
  // SAFETY: These tests deliberately exercise the port's runtime command
  // decoder with structurally invalid values that TypeScript cannot represent.
  return port.enterFinishing(command as PointCommitFinishingTransitionCommandV1);
}

export interface StoredAttemptEvidenceLoaderLeaseHarness<Scenario> {
  readonly scenario: (label: string) => Promise<Scenario>;
  readonly seal: (current: Scenario) => Promise<unknown>;
  readonly shortenHardExpiryBeforeGrant: (
    current: Scenario,
  ) => Promise<number>;
  readonly load: (
    current: Scenario,
  ) => ReturnType<StoredAttemptEvidenceLoaderV1["loadEffect"]>;
}

export function registerStoredAttemptEvidenceLoaderLeaseTests<Scenario>(
  harness: StoredAttemptEvidenceLoaderLeaseHarness<Scenario>,
): void {
  it("loads a sealed lease promoted to a hard expiry below the grant", async () => {
    const current = await harness.scenario("hard_before_grant");
    const hardExpiresAtMilliseconds =
      await harness.shortenHardExpiryBeforeGrant(current);
    await harness.seal(current);

    const result = await runEffect(harness.load(current));
    if (result.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(result.evidence.lease.leaseExpiresAtMilliseconds).toBe(
      hardExpiresAtMilliseconds,
    );
    expect(result.evidence.session.hardExpiresAtMilliseconds).toBe(
      hardExpiresAtMilliseconds,
    );
    expect(
      result.evidence.session.authorizationGrantExpiresAtMilliseconds,
    ).toBeGreaterThan(hardExpiresAtMilliseconds);
  });
}

export interface StoredAttemptEvidenceLoaderLifecycleScenario {
  readonly loader: StoredAttemptFinishingEvidenceLoaderV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
}

export interface StoredAttemptEvidenceLoaderLifecycleHarness<
  Scenario extends StoredAttemptEvidenceLoaderLifecycleScenario,
> {
  readonly scenario: (label: string) => Promise<Scenario>;
  readonly seal: (current: Scenario) => Promise<unknown>;
  readonly selector: (
    current: Scenario,
  ) => PointMutationSessionAttemptSelectorV1;
  readonly createFinishingTransitionPort: () =>
    PointCommitFinishingTransitionPortV1;
  readonly setLifecycle: (
    current: Scenario,
    lifecycle: TransactionSessionLifecycleV1,
  ) => Promise<void>;
  readonly deleteLease: (current: Scenario) => Promise<void>;
  readonly prepareRootState: (
    current: Scenario,
    lifecycle: "running" | "finishing",
    rootState: "open" | "failed",
  ) => Promise<void>;
  readonly deleteRoot: (current: Scenario) => Promise<void>;
  readonly shiftLeaseEarlier: (current: Scenario) => Promise<void>;
  readonly expireLease: (current: Scenario) => Promise<void>;
  readonly expireSessionAndLease: (current: Scenario) => Promise<void>;
}

export function registerStoredAttemptEvidenceLoaderLifecycleTests<
  Scenario extends StoredAttemptEvidenceLoaderLifecycleScenario,
>(
  harness: StoredAttemptEvidenceLoaderLifecycleHarness<Scenario>,
): void {
  it("accepts finishing+sealed for reconstruction but rejects every other lifecycle", async () => {
    const finishing = await harness.scenario("finishing_sealed");
    await harness.seal(finishing);
    const runningEvidence = await runEffect(
      finishing.loader.loadEffect(finishing.authority),
    );
    if (runningEvidence.kind !== "loaded") {
      throw new Error("Expected running evidence before C05-A transition.");
    }
    await runEffect(
      harness.createFinishingTransitionPort().enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          finishing.authority,
          runningEvidence.evidence,
        ),
      ),
    );
    const finishingResult = await runEffect(
      finishing.loader.loadFinishingEffect(harness.selector(finishing)),
    );
    expect(finishingResult).toMatchObject({
      kind: "loaded",
      evidence: { session: { lifecycle: "finishing" } },
    });

    const running = await harness.scenario("running_recovery_rejected");
    await harness.seal(running);
    await expect(runEffect(running.loader.loadFinishingEffect(
      harness.selector(running),
    ))).resolves.toMatchObject({
      kind: "notPlannable",
      reason: "lifecycle",
      lifecycle: "running",
    });

    const committed = await harness.scenario("committed_observation");
    await harness.seal(committed);
    await harness.setLifecycle(committed, "committed");
    await harness.deleteLease(committed);
    await expect(runEffect(committed.loader.loadFinishingEffect(
      harness.selector(committed),
    ))).resolves.toMatchObject({ kind: "alreadyCommitted" });

    const otherLifecycles: ReadonlyArray<TransactionSessionLifecycleV1> = [
      "created",
      "committing",
      "retrying",
      "aborted",
      "expired",
    ];
    for (const lifecycle of otherLifecycles) {
      const current = await harness.scenario(`lifecycle_${lifecycle}`);
      await harness.seal(current);
      await harness.setLifecycle(current, lifecycle);
      await harness.deleteLease(current);
      await expect(runEffect(current.loader.loadFinishingEffect(
        harness.selector(current),
      ))).resolves.toMatchObject({
        kind: "notPlannable",
        reason: "lifecycle",
        lifecycle,
      });
    }
  });

  it("rejects every open/failed root for both accepted active lifecycles", async () => {
    for (const lifecycle of ["running", "finishing"] as const) {
      for (const rootState of ["open", "failed"] as const) {
        const current = await harness.scenario(
          `root_${lifecycle}_${rootState}`,
        );
        await harness.prepareRootState(current, lifecycle, rootState);
        const load = lifecycle === "running"
          ? current.loader.loadEffect(current.authority)
          : current.loader.loadFinishingEffect(harness.selector(current));
        await expect(runEffect(load)).resolves.toMatchObject({
          kind: "notPlannable",
          reason: "rootNotSealed",
          rootState,
        });
      }
    }
  });

  it("fails closed when an active sealed attempt loses its lease or root", async () => {
    const missingLease = await harness.scenario("missing_lease");
    await harness.seal(missingLease);
    await harness.deleteLease(missingLease);
    await expect(runEffect(
      missingLease.loader.loadEffect(missingLease.authority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "snapshotLeaseMissingOrDuplicate",
    });

    const missingRoot = await harness.scenario("missing_root");
    await harness.seal(missingRoot);
    await harness.deleteRoot(missingRoot);
    await expect(runEffect(
      missingRoot.loader.loadEffect(missingRoot.authority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "journalRootMissingOrDuplicate",
    });

    const nonTargetLease = await harness.scenario("sealed_non_target_lease");
    await harness.seal(nonTargetLease);
    await harness.shiftLeaseEarlier(nonTargetLease);
    await expect(runEffect(
      nonTargetLease.loader.loadEffect(nonTargetLease.authority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "snapshotLeaseInvalid",
    });
    await harness.expireLease(nonTargetLease);
    await expect(runEffect(
      nonTargetLease.loader.loadEffect(nonTargetLease.authority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "snapshotLeaseInvalid",
    });
  });

  it("uses database time and rejects expired or replaced exact attempts", async () => {
    const expired = await harness.scenario("lease_expired");
    await harness.seal(expired);
    await harness.expireSessionAndLease(expired);
    await expect(runEffect(expired.loader.loadEffect(expired.authority))).resolves
      .toMatchObject({ kind: "notPlannable", reason: "expired" });

    const replaced = await harness.scenario("attempt_replaced");
    await harness.seal(replaced);
    await expect(runEffect(replaced.loader.loadEffect({
      ...replaced.authority,
      attemptFence: TransactionAttemptFenceSchema.make(
        replaced.authority.attemptFence + 1n,
      ),
    }))).resolves.toMatchObject({
      kind: "authorityMismatch",
      reason: "attemptReplaced",
    });
  });
}

export interface StoredAttemptEvidenceLoaderIntegrityScenario {
  readonly loader: StoredAttemptEvidenceLoaderV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
}

export interface StoredAttemptEvidenceLoaderIntegrityHarness<
  Scenario extends StoredAttemptEvidenceLoaderIntegrityScenario,
> {
  readonly scenario: (label: string) => Promise<Scenario>;
  readonly seal: (current: Scenario) => Promise<unknown>;
  readonly advanceAuthorizationRevocationEpoch: (
    current: Scenario,
  ) => Promise<void>;
  readonly withMalformedLeaseCommitSequence: <Result>(
    current: Scenario,
    work: () => Promise<Result>,
  ) => Promise<Result>;
  readonly withMalformedLegacyExecutionAuthority: <Result>(
    current: Scenario,
    work: () => Promise<Result>,
  ) => Promise<Result>;
}

export function registerStoredAttemptEvidenceLoaderIntegrityTests<
  Scenario extends StoredAttemptEvidenceLoaderIntegrityScenario,
>(
  harness: StoredAttemptEvidenceLoaderIntegrityHarness<Scenario>,
): void {
  it("rejects stale generation, epoch, snapshot, schema, and revocation pins", async () => {
    const current = await harness.scenario("stale_pins");
    await harness.seal(current);
    const staleAuthorities = [
      {
        authority: {
          ...current.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(99n),
        },
        reason: "generationChanged",
      },
      {
        authority: {
          ...current.authority,
          snapshotToken: SnapshotTokenSchema.make({
            ...current.authority.snapshotToken,
            epoch: ScopeEpochSchema.make("epoch_stale_c04a"),
          }),
        },
        reason: "epochChanged",
      },
      {
        authority: {
          ...current.authority,
          snapshotToken: SnapshotTokenSchema.make({
            ...current.authority.snapshotToken,
            commitSeq: CommitSeqSchema.make(
              current.authority.snapshotToken.commitSeq + 1n,
            ),
          }),
        },
        reason: "snapshotChanged",
      },
      {
        authority: {
          ...current.authority,
          schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_stale"),
        },
        reason: "schemaChanged",
      },
    ] as const satisfies ReadonlyArray<Readonly<{
      readonly authority: StoredAttemptEvidenceAuthorityV1;
      readonly reason: string;
    }>>;
    for (const stale of staleAuthorities) {
      await expect(runEffect(
        current.loader.loadEffect(stale.authority),
      )).resolves.toMatchObject({
        kind: "authorityMismatch",
        reason: stale.reason,
      });
    }

    await harness.advanceAuthorizationRevocationEpoch(current);
    await expect(runEffect(
      current.loader.loadEffect(current.authority),
    )).resolves.toMatchObject({
      kind: "authorityMismatch",
      reason: "revocationEpochChanged",
    });
  });

  it("keeps malformed detached lease scalars in the corruption result", async () => {
    const current = await harness.scenario("malformed_lease_commit_seq");
    await harness.seal(current);
    await harness.withMalformedLeaseCommitSequence(current, async () => {
      const result = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      expect(result).toMatchObject({
        kind: "corrupt",
        reason: "sessionRecordInvalid",
      });
      if (result.kind !== "corrupt") {
        throw new Error("Expected malformed lease corruption.");
      }
      expect(Schema.isSchemaError(result.cause)).toBe(true);
    });
  });

  it("keeps malformed legacy execution authority in the corruption result", async () => {
    const current = await harness.scenario("malformed_legacy_authority");
    await harness.seal(current);
    await harness.withMalformedLegacyExecutionAuthority(current, async () => {
      await expect(runEffect(current.loader.loadEffect(current.authority)))
        .resolves.toMatchObject({
          kind: "corrupt",
          reason: "sessionRecordInvalid",
        });
    });
  });
}
