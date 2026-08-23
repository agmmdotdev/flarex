import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import {
  TaskResultStoreSettlementUncertainError,
} from "flarex-backend/internal/task-result-store";
import {
  isExclusiveResultPublicationUncertaintyCauseV1,
} from "../../src/environment/standardApplicationTaskDeliveryV1";

const commitment = Object.freeze({
  codec: "flarex.task-result.v1" as const,
  byteLength: 1,
  sha256: new Uint8Array(32),
});

describe("StandardApplicationTaskDeliveryV1 fault evidence", () => {
  it("accepts only the exclusive reconcile-read uncertainty cause", () => {
    const uncertainty = new TaskResultStoreSettlementUncertainError({
      commitment,
      stage: "reconcileRead",
    });
    const exclusive = Cause.fail(uncertainty);
    const combined = Cause.combine(
      exclusive,
      Cause.die(new Error("session close failed")),
    );

    expect(isExclusiveResultPublicationUncertaintyCauseV1(exclusive)).toBe(true);
    expect(isExclusiveResultPublicationUncertaintyCauseV1(combined)).toBe(false);
  });
});
