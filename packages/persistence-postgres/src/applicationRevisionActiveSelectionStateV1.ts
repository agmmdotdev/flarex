import { copyBytes } from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import type { SchemaManifestAppSchemaV1 } from
  "flarex-protocol/schema-manifest";
import type {
  DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type {
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";

import type {
  ActiveApplicationRevisionMetadataV1,
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "./applicationRevisionActivationV1";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import type { LoadedCandidateRuntimePublicationV1 } from
  "./candidateRuntimePublicationRepositoryV1";

export interface ActiveApplicationRevisionRuntimeTargetBasisV1 {
  readonly attemptSha256: Uint8Array;
  readonly functionMetadataBytes: Uint8Array;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly candidateFrameBytes: Uint8Array;
  readonly publication: LoadedCandidateRuntimePublicationV1["publication"];
}

export interface ActiveApplicationRevisionSyscallValidatorBasisV1 {
  readonly metadata: ActiveApplicationRevisionMetadataV1;
  readonly authority: TrustedScopeAuthority;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

export interface ActiveApplicationRevisionRuntimeTargetStateV1 {
  readonly metadata: ActiveApplicationRevisionMetadataV1;
  readonly authority: TrustedScopeAuthority;
  readonly runtimeTarget: ActiveApplicationRevisionRuntimeTargetBasisV1;
}

interface ActiveApplicationRevisionSelectionStateV1
  extends ActiveApplicationRevisionSyscallValidatorBasisV1 {
  readonly runtimeTarget: ActiveApplicationRevisionRuntimeTargetBasisV1;
}

export class InvalidActiveApplicationRevisionSelectionV1Error
  extends Data.TaggedError(
    "InvalidActiveApplicationRevisionSelectionV1Error",
  )<{
    readonly reason: "notIssued";
  }> {}

const states = new WeakMap<
  AuthenticatedActiveApplicationRevisionSelectionV1,
  ActiveApplicationRevisionSelectionStateV1
>();

export function issueActiveApplicationRevisionSelectionV1(
  metadata: ActiveApplicationRevisionMetadataV1,
  authority: TrustedScopeAuthority,
  schemaManifest: SchemaManifestAppSchemaV1,
  runtimeTarget: ActiveApplicationRevisionRuntimeTargetBasisV1,
): AuthenticatedActiveApplicationRevisionSelectionV1 {
  // SAFETY: the selection is an inert identity token; all state lives in
  // the module-local WeakMap keyed by this object identity.
  const selection = Object.freeze({}) as
    AuthenticatedActiveApplicationRevisionSelectionV1;
  states.set(selection, Object.freeze({
    metadata: copyActiveApplicationRevisionMetadataV1(metadata),
    authority: copyAuthority(authority),
    schemaManifest,
    runtimeTarget: copyRuntimeTargetBasis(runtimeTarget),
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
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered brand.
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

export function claimActiveApplicationRevisionRuntimeTargetStateV1(
  selection: unknown,
): Result.Result<
  ActiveApplicationRevisionRuntimeTargetStateV1,
  InvalidActiveApplicationRevisionSelectionV1Error
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(new InvalidActiveApplicationRevisionSelectionV1Error({
      reason: "notIssued",
    }));
  }
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered brand.
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
      runtimeTarget: copyRuntimeTargetBasis(state.runtimeTarget),
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

function copyRuntimeTargetBasis(
  basis: ActiveApplicationRevisionRuntimeTargetBasisV1,
): ActiveApplicationRevisionRuntimeTargetBasisV1 {
  return Object.freeze({
    attemptSha256: copyBytes(basis.attemptSha256),
    functionMetadataBytes: copyBytes(basis.functionMetadataBytes),
    candidate: copyCandidate(basis.candidate),
    candidateSha256: copyBytes(basis.candidateSha256),
    candidateFrameBytes: copyBytes(basis.candidateFrameBytes),
    publication: Object.freeze({
      projectionSetReference: copyReference(
        basis.publication.projectionSetReference,
      ),
      manifestReference: copyReference(basis.publication.manifestReference),
      manifestFrame: Object.freeze({
        ...basis.publication.manifestFrame,
        runtimeProjectionSetSha256: copyBytes(
          basis.publication.manifestFrame.runtimeProjectionSetSha256,
        ),
        functionRootSha256: copyBytes(
          basis.publication.manifestFrame.functionRootSha256,
        ),
        validatorRootSha256: copyBytes(
          basis.publication.manifestFrame.validatorRootSha256,
        ),
        declaredHandlerSetSha256: copyBytes(
          basis.publication.manifestFrame.declaredHandlerSetSha256,
        ),
      }),
      projections: Object.freeze(basis.publication.projections.map(projection =>
        Object.freeze({
          frame: Object.freeze({
            ...projection.frame,
            moduleRootSha256: copyBytes(projection.frame.moduleRootSha256),
          }),
          reference: copyReference(projection.reference),
          modules: Object.freeze(projection.modules.map(module => Object.freeze({
            ...module,
            sourceSha256: copyBytes(module.sourceSha256),
            reference: copyReference(module.reference),
          }))),
        })
      )),
      functionEntries: Object.freeze(
        basis.publication.functionEntries.map(entry => Object.freeze({
          frame: Object.freeze({
            ...entry.frame,
            projectionSha256: copyBytes(entry.frame.projectionSha256),
          }),
          reference: copyReference(entry.reference),
        })),
      ),
    }),
  });
}

function copyCandidate(
  candidate: DeclarativeV2CandidateFrameV1,
): DeclarativeV2CandidateFrameV1 {
  return Object.freeze({
    ...candidate,
    sourceRootSha256: copyBytes(candidate.sourceRootSha256),
    sourceSelectorSha256: copyBytes(candidate.sourceSelectorSha256),
    semanticRootSha256: copyBytes(candidate.semanticRootSha256),
    semanticSelectorSha256: copyBytes(candidate.semanticSelectorSha256),
    packageSha256: copyBytes(candidate.packageSha256),
    artifactSha256: copyBytes(candidate.artifactSha256),
    schemaArtifactSha256: copyBytes(candidate.schemaArtifactSha256),
    schemaBindingSha256: copyBytes(candidate.schemaBindingSha256),
    validatorRootSha256: copyBytes(candidate.validatorRootSha256),
    declaredHandlerSetSha256: copyBytes(candidate.declaredHandlerSetSha256),
    deploymentAnalysisSha256: copyBytes(candidate.deploymentAnalysisSha256),
    deploymentCodegenAnalysisSha256: copyBytes(
      candidate.deploymentCodegenAnalysisSha256,
    ),
    runtimeProjectionSetSha256: copyBytes(
      candidate.runtimeProjectionSetSha256,
    ),
    functionGroupManifestSha256: copyBytes(
      candidate.functionGroupManifestSha256,
    ),
  });
}

function copyReference(
  reference: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): DeclarativeV2RuntimeArtifactObjectReferenceV1 {
  return Object.freeze({ ...reference, sha256: copyBytes(reference.sha256) });
}
