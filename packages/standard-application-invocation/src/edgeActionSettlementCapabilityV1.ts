import type {
  DirectActionExecutionSubjectCapabilityV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";

declare const settlementBrand: unique symbol;
export interface ActiveApplicationEdgeActionSettlementV1 {
  readonly [settlementBrand]: true;
}

const settlementStates = new WeakMap<
  object,
  DirectActionExecutionSubjectCapabilityV1
>();

export function issueActiveApplicationEdgeActionSettlementV1(
  subject: DirectActionExecutionSubjectCapabilityV1,
): ActiveApplicationEdgeActionSettlementV1 {
  const settlement = Object.freeze({}) as
    ActiveApplicationEdgeActionSettlementV1;
  settlementStates.set(settlement, subject);
  return settlement;
}

export function inspectActiveApplicationEdgeActionSettlementV1(
  settlement: unknown,
): DirectActionExecutionSubjectCapabilityV1 | undefined {
  return settlement !== null && typeof settlement === "object"
    ? settlementStates.get(settlement)
    : undefined;
}

export function revokeActiveApplicationEdgeActionSettlementV1(
  settlement: ActiveApplicationEdgeActionSettlementV1,
): void {
  settlementStates.delete(settlement);
}
