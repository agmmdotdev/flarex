import { APIError, ValidationError } from "payload";
import { Effect } from "effect";
import { cmsError, CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";

export class UnsupportedPayloadCapability extends APIError {
  constructor(readonly capability: string) {
    super(`Unsupported private Payload capability: ${capability}`, 400);
  }
}

export const projectPayloadFailure = (cause: unknown): Effect.Effect<never, CmsTransactionError> => {
  if (cause instanceof CmsTransactionError) return Effect.fail(cause);
  if (cause instanceof ValidationError) return Effect.fail(cmsError("documentInvalid", cause));
  if (cause instanceof UnsupportedPayloadCapability) return Effect.fail(cmsError("unsupportedProfile", cause));
  if (cause instanceof APIError) return Effect.fail(cmsError(cause.status === 404 ? "documentMissing" : "invalidInput", cause));
  return Effect.die(cause);
};
