import { Effect, Scope } from "effect";
import { decodeCatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";

import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "./applicationRevisionActivationV1";
import { claimActiveApplicationRevisionSyscallValidatorBasisV1 } from
  "./applicationRevisionActiveSelectionStateV1";
import {
  InvalidApplicationRevisionSyscallValidatorV1Error,
} from "./applicationRevisionSyscallValidatorV1";
import {
  activationFencedSyscallValidatorStateV1,
  issueApplicationRevisionSyscallValidatorStateV1,
  revokeApplicationRevisionSyscallValidatorStateV1,
  type ApplicationRevisionSyscallValidatorV1,
} from "./applicationRevisionSyscallValidatorStateV1";

/** Historical activation-fenced validator retained only for system proofs. */
export const deriveApplicationRevisionSyscallValidatorV1 = Effect.fn(
  "ApplicationRevisionSyscallValidator.derive",
)(function* (
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
): Effect.fn.Return<
  ApplicationRevisionSyscallValidatorV1,
  InvalidApplicationRevisionSyscallValidatorV1Error,
  Scope.Scope
> {
  const basis = yield* Effect.fromResult(
    claimActiveApplicationRevisionSyscallValidatorBasisV1(selection),
  ).pipe(Effect.mapError(() =>
    new InvalidApplicationRevisionSyscallValidatorV1Error({
      reason: "notIssued",
    })
  ));
  const state = activationFencedSyscallValidatorStateV1({
    selection,
    scopeId: basis.metadata.scopeId,
    schemaVersionId: decodeCatalogSchemaVersionId(
      basis.metadata.schemaVersionId,
    ),
    schemaManifest: basis.schemaManifest,
  });
  return yield* Effect.acquireRelease(
    Effect.sync(() => issueApplicationRevisionSyscallValidatorStateV1(state)),
    capability => Effect.sync(() => {
      revokeApplicationRevisionSyscallValidatorStateV1(capability);
    }),
  );
});
