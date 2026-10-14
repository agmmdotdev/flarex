import { Result } from "effect";
import { capturePrivateJsonDataOmittingUndefined, commerceError, defaultCommerceResources, type CommerceResources, type Json, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Native Medusa option objects omit own undefined members. The value owner
 * captures that representation once; Medusa selects its native limits here. */
export function captureCommerceInput(input: unknown, resources: Pick<CommerceResources, "commandBytes" | "valueNodes"> = defaultCommerceResources, onOmitted?: (path: readonly string[]) => void): Result.Result<Json, CommerceTransactionError> {
  return capturePrivateJsonDataOmittingUndefined(input,
    { bytes: resources.commandBytes, nodes: resources.valueNodes, depth: 16 },
    commerceError, onOmitted).pipe(Result.map(captured => captured.value));
}
