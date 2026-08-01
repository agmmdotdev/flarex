import { copyBytes } from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import type { SchemaManifestAppSchemaV1 } from
  "flarex-protocol/schema-manifest";

import type {
  ActiveApplicationRevisionMetadataV1,
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "./applicationRevisionActivationV1";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";

export interface ActiveApplicationRevisionSyscallValidatorBasisV1 {
  readonly metadata: ActiveApplicationRevisionMetadataV1;
  readonly authority: TrustedScopeAuthority;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

export class InvalidActiveApplicationRevisionSelectionV1Error
  extends Data.TaggedError(
    "InvalidActiveApplicationRevisionSelectionV1Error",
  )<{
    readonly reason: "notIssued";
  }> {}

const states = new WeakMap<
  AuthenticatedActiveApplicationRevisionSelectionV1,
  ActiveApplicationRevisionSyscallValidatorBasisV1
>();

export function issueActiveApplicationRevisionSelectionV1(
  metadata: ActiveApplicationRevisionMetadataV1,
  authority: TrustedScopeAuthority,
  schemaManifest: SchemaManifestAppSchemaV1,
): AuthenticatedActiveApplicationRevisionSelectionV1 {
  const selection = Object.freeze({}) as
    AuthenticatedActiveApplicationRevisionSelectionV1;
  states.set(selection, Object.freeze({
    metadata: copyActiveApplicationRevisionMetadataV1(metadata),
    authority: copyAuthority(authority),
    schemaManifest,
  }));
  return selection;
}

export function revokeActiveApplicationRevisionSelectionV1(
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
): void {
  states.delete(selection);
}

export function inspectActiveApplicationRevisionSelectionStateV1(
  selection: unknown,
): Result.Result<
  ActiveApplicationRevisionMetadataV1,
  InvalidActiveApplicationRevisionSelectionV1Error
> {
  return claimActiveApplicationRevisionSyscallValidatorBasisV1(selection).pipe(
    Result.map(basis => basis.metadata),
  );
}

export function claimActiveApplicationRevisionSyscallValidatorBasisV1(
  selection: unknown,
): Result.Result<
  ActiveApplicationRevisionSyscallValidatorBasisV1,
  InvalidActiveApplicationRevisionSelectionV1Error
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(new InvalidActiveApplicationRevisionSelectionV1Error({
      reason: "notIssued",
    }));
  }
  const state = states.get(
    selection as AuthenticatedActiveApplicationRevisionSelectionV1,
  );
  return state === undefined
    ? Result.fail(new InvalidActiveApplicationRevisionSelectionV1Error({
      reason: "notIssued",
    }))
    : Result.succeed(Object.freeze({
      metadata: copyActiveApplicationRevisionMetadataV1(state.metadata),
      authority: copyAuthority(state.authority),
      schemaManifest: state.schemaManifest,
    }));
}

export function copyActiveApplicationRevisionMetadataV1(
  metadata: ActiveApplicationRevisionMetadataV1,
): ActiveApplicationRevisionMetadataV1 {
  return Object.freeze({
    ...metadata,
    candidateSha256: copyBytes(metadata.candidateSha256),
    readinessReceiptSha256: copyBytes(metadata.readinessReceiptSha256),
    activationHeadSha256: copyBytes(metadata.activationHeadSha256),
    packageSha256: copyBytes(metadata.packageSha256),
    artifactSha256: copyBytes(metadata.artifactSha256),
    sourceRootSha256: copyBytes(metadata.sourceRootSha256),
    semanticRootSha256: copyBytes(metadata.semanticRootSha256),
    schemaArtifactSha256: copyBytes(metadata.schemaArtifactSha256),
    schemaBindingSha256: copyBytes(metadata.schemaBindingSha256),
    functionMetadataSha256: copyBytes(metadata.functionMetadataSha256),
    validatorRootSha256: copyBytes(metadata.validatorRootSha256),
    declaredHandlerSetSha256: copyBytes(metadata.declaredHandlerSetSha256),
    runtimeProjectionSetSha256: copyBytes(metadata.runtimeProjectionSetSha256),
    functionGroupManifestSha256: copyBytes(
      metadata.functionGroupManifestSha256,
    ),
  });
}

function copyAuthority(authority: TrustedScopeAuthority): TrustedScopeAuthority {
  return Object.freeze({
    ...authority,
    physicalLocator: Object.freeze({ ...authority.physicalLocator }),
  });
}
