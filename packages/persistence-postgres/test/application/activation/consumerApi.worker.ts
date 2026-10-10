import * as activation from "@flarex/persistence-postgres/internal/application-activation";
import { Result } from "effect";

export default {
  fetch() {
    let getters = 0;
    const copiedSelection = Object.create(null, {
      basis: {
        get() {
          getters++;
          throw new Error("Copied authority must not be inspected");
        },
      },
    });
    const claim = activation.claimApplicationActiveSelection(copiedSelection);
    return Response.json({
      exports: Object.keys(activation).sort(),
      claim: Result.isFailure(claim) ? {
        tag: claim.failure._tag,
        operation: claim.failure.operation,
        reason: claim.failure.reason,
      } : "unexpected authority",
      getters,
    });
  },
};
