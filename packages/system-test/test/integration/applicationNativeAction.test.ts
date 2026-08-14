import { describe, expect, it, vi } from "vitest";

const legacyOperations = vi.hoisted(() => ({ readActive: vi.fn() }));

vi.mock(
  "@flarex/persistence-postgres/internal/system-test/application-revision-activation-v1",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    readActiveApplicationRevisionV1: legacyOperations.readActive,
  }),
);

import {
  proveApplicationNativeAction,
} from "../../support/applicationNativeActionHarness";

describe("Application-native Standard action", () => {
  it("proves the exclusive Application service cut and durable effects", async () => {
    await expect(proveApplicationNativeAction()).resolves.toMatchObject({
      completed: true,
      exactReplay: true,
      conflictingReuseRejected: true,
      headMovementBeforeAdmissionRejected: true,
      exactReplayAfterHeadMovement: true,
      admittedHeadStayedPinned: true,
      staleAdmittedResumeFailedClosed: true,
      cancelledReplay: true,
      expiredExecutionRecovered: true,
      interruptionWaitedForCleanup: true,
      legacyAccesses: 0,
      freshDistinctDispatches: true,
      childMutationConfirmed: true,
      outboundConfirmed: true,
      outboundUncertain: true,
      structuredApplicationError: true,
      terminalFailure: true,
    });
    expect(legacyOperations.readActive).not.toHaveBeenCalled();
  }, 480_000);
});
