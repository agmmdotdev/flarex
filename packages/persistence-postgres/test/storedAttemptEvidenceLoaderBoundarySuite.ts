import { expect, expectTypeOf, it } from "vitest";

import type { StoredAttemptEvidenceLoaderPortV1 } from
  "../../executor/src/storedAttemptAuthentication";
import * as persistenceRoot from "../src";
import type { PointMutationSessionAnchorV1 } from
  "../src/transactionSessionActivation";
import {
  StoredAttemptEvidencePersistenceV1Error,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
}
