import { expect, it } from "vitest";

import {
  proveApplicationActionAuthorityV1,
} from "../../support/applicationActionAuthorityV1Harness";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationPersistence,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";

export function defineApplicationActionAuthorityContract(adapter: Readonly<{
  name: "pglite" | "postgres";
  runScenario: <A>(scenario: (fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>) => Promise<A>) => Promise<A>;
}>): void {
  it("preserves admission races, write rollback, recovery and transaction cleanup", async () => {
    const proof = await adapter.runScenario(fixture => proveApplicationActionAuthorityV1(fixture, adapter.name));
    expect(proof).toMatchObject({
      lane: adapter.name,
      concurrentAdmission: ["inserted", "replayed"],
      contradictoryReuseRejected: true,
      singularClaim: true,
      effectOrdinals: [1n, 2n],
      completedReplay: true,
      cancellationBeforeExecution: true,
      cancellationRecoveryTerminal: true,
      safeRecoveryGeneration: 2n,
      dispatchRecoveryUncertain: true,
      terminalEffectEvidence: true,
      malformedReferenceRejected: true,
      staleAuthorityRejected: true,
      lostResponseReplayed: true,
      rollbackProof: true,
      interruptionWaitsForTransaction: true,
      mutableDigestCaptured: true,
      storedBodyColumnCount: 0,
    });
    expect(proof.invocationCount).toBeGreaterThanOrEqual(9);
    expect(proof.effectCount).toBeGreaterThanOrEqual(8);
    if (adapter.name === "postgres") expect(proof.postgresVersion).toContain("PostgreSQL");
    else expect(proof.postgresVersion).toBeNull();
  }, 120_000);
}
