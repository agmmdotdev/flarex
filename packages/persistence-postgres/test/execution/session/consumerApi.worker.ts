import * as session from "@flarex/persistence-postgres/internal/session";
import { Result } from "effect";

export default {
  fetch() {
    let getters = 0;
    const copiedRecovery = Object.create(null, {
      context: {
        get() {
          getters++;
          throw new Error("Copied recovery evidence must not be inspected");
        },
      },
    });
    const inspection: unknown = Reflect.apply(session.readFiniteRecoveryAttempt, undefined, [copiedRecovery]);
    const failure = Result.isResult(inspection) && Result.isFailure(inspection)
      ? inspection.failure : undefined;
    return Response.json({
      exports: Object.keys(session).sort(),
      recovery: failure instanceof session.PointMutationExecutionClaimAcquisitionInputV1Error ? {
        tag: failure._tag,
        reason: failure.reason,
      } : "unexpected authority",
      getters,
    });
  },
};
