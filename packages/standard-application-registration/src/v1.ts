import {
  registerApplicationRevisionV1,
  type ApplicationRevisionRegistrationContextV1,
  type ApplicationRevisionRegistrationRequestKeyV1,
  type RegisterApplicationRevisionV1Error,
} from
  "@flarex/persistence-postgres/internal/system-test/applicationRevisionRegistrationV1";
import type {
  AuthenticatedVerifiedStandardApplicationAnalysisV1,
} from "@flarex/standard-application-analysis/internal/system-test/legacy-v1";
import { Effect, Scope } from "effect";

export interface RegisteredStandardApplicationRevisionV1 {
  readonly status: "registered";
  readonly revisionId: string;
  readonly schemaVersionId: string;
  readonly registeredAt: string;
}

export type RegisterStandardApplicationRevisionV1Error =
  RegisterApplicationRevisionV1Error;

/**
 * SAP03 is a total narrowing over the implementation-bearing System operation.
 *
 * Internal scope, attempt, candidate, and digest evidence remains private.
 */
export const registerStandardApplicationRevisionV1: (
  verifiedAnalysis: AuthenticatedVerifiedStandardApplicationAnalysisV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  context: ApplicationRevisionRegistrationContextV1,
) => Effect.Effect<
  RegisteredStandardApplicationRevisionV1,
  RegisterStandardApplicationRevisionV1Error,
  Scope.Scope
> = Effect.fn(
  "StandardApplication.registerRevisionV1",
)(function* (
  verifiedAnalysis: AuthenticatedVerifiedStandardApplicationAnalysisV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  context: ApplicationRevisionRegistrationContextV1,
): Effect.fn.Return<
  RegisteredStandardApplicationRevisionV1,
  RegisterStandardApplicationRevisionV1Error,
  Scope.Scope
> {
  const registered = yield* registerApplicationRevisionV1(
    verifiedAnalysis,
    requestKey,
    context,
  );
  return Object.freeze({
    status: "registered",
    revisionId: registered.revisionId,
    schemaVersionId: registered.schemaVersionId,
    registeredAt: registered.registeredAt.toISOString(),
  });
});

export {
  type ApplicationRevisionRegistrationContextV1,
  type ApplicationRevisionRegistrationRequestKeyV1,
};
