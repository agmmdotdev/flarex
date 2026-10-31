import { APIError, ValidationError } from "payload";
import { Cause, Context } from "effect";
import { cmsError, CmsTransactionError, reclassifyBoundedRequestReason } from "@flarex/persistence-postgres/internal/cms-adapter";

export class UnsupportedPayloadCapability extends APIError {
  constructor(readonly capability: string) {
    super(`Unsupported private Payload capability: ${capability}`, 400);
  }
}

function payloadFailure(cause: unknown): CmsTransactionError | undefined {
  if (cause instanceof CmsTransactionError) return cause;
  if (cause instanceof ValidationError) return cmsError("documentInvalid", cause);
  if (cause instanceof UnsupportedPayloadCapability) return cmsError("unsupportedProfile", cause);
  if (cause instanceof APIError) return cmsError(cause.status === 404 ? "documentMissing" : "invalidInput", cause);
  return undefined;
}
/** Draining can combine rejection with interruption; retain every original reason. */
export const projectPayloadCause = (cause: Cause.Cause<unknown>): Cause.Cause<CmsTransactionError> =>
  Cause.fromReasons(cause.reasons.map(reason => {
    if (!Cause.isFailReason(reason)) return reason;
    const failure = payloadFailure(reason.error);
    const projected = failure === undefined ? Cause.makeDieReason(reason.error) : Cause.makeFailReason(failure);
    return reclassifyBoundedRequestReason(reason,
      projected.annotate(Context.makeUnsafe(new Map(reason.annotations)), { overwrite: true }));
  }));
