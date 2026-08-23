import { expect, expectTypeOf, it } from "vitest";
import type { TransactionSessionLifecycleV1 } from
  "flarex-protocol/transaction-session";

import type { StoredAttemptEvidenceLoaderPortV1 } from
  "../../executor/src/storedAttemptAuthentication";
import * as persistenceRoot from "../src";
import type {
  PointCommitFinishingTransitionCommandV1,
  PointCommitFinishingTransitionPortV1,
  PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import type { PointMutationSessionAnchorV1 } from
  "../src/transactionSessionActivation";
import {
  StoredAttemptEvidencePersistenceV1Error,
  type StoredAttemptEvidenceAuthorityV1,
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
