import { Effect } from "effect";
import type { FrameworkSchemaArtifact, FrameworkSchemaArtifactIdentity } from "../frameworkSchema/artifact/model";
import { copyCapturedFrameworkSchemaArtifactEvidence } from "../frameworkSchema/artifact/canonical";
import { isCapturedRelationalPhysicalLayout } from "../relationalSchema/physical/canonical";
import type { RelationalPhysicalLayout } from "../relationalSchema/physical/model";
import type { RelationalMigrationPlan } from "../migrationCoordination/model";
import { commerceError, commerceLimits } from "./model";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";

declare const commerceProfileBrand: unique symbol;
export interface CommerceProfile { readonly [commerceProfileBrand]: true }
export interface CommerceProfileState {
  readonly artifact: FrameworkSchemaArtifact;
  readonly layout: RelationalPhysicalLayout;
  readonly profileId: string;
  readonly initialization: Readonly<{ stepId: string; datasetSha256: string; expectedRowCount: number }>;
  readonly contractSha256: string;
}
const profiles = new WeakMap<object, CommerceProfileState>();
const sameArtifactIdentity = (left: FrameworkSchemaArtifactIdentity, right: FrameworkSchemaArtifactIdentity): boolean =>
  left.deploymentId === right.deploymentId && left.owner === right.owner &&
  left.lineageId === right.lineageId && left.artifactSha256 === right.artifactSha256;

/** Trusted composition only; the adapter supplies its captured actual-model descriptor.
 * This issuer is source-private and is never a command, schema-value or public API.
 */
export const registerCommerceProfile = Effect.fn("CommerceProfile.register")(function* (
  artifact: FrameworkSchemaArtifact,
  layout: RelationalPhysicalLayout,
  profileId: string,
  initialization: Readonly<{ stepId: string; datasetSha256: string; expectedRowCount: number }>,
) {
  if (copyCapturedFrameworkSchemaArtifactEvidence(artifact) === undefined || !isCapturedRelationalPhysicalLayout(layout)) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const table = layout.frame.tables[0];
  const { stepId, datasetSha256, expectedRowCount } = initialization;
  if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(profileId) || !/^[a-z][a-z0-9_.-]{0,127}$/.test(stepId) ||
    !/^[0-9a-f]{64}$/.test(datasetSha256) || !Number.isSafeInteger(expectedRowCount) || expectedRowCount < 0 || expectedRowCount > commerceLimits.catalogRows ||
    artifact.identity.owner !== "medusa" ||
    artifact.provenance.kind !== "sourceSnapshot" || artifact.dependencies.length !== 0 ||
    !sameArtifactIdentity(artifact.identity, layout.frame.artifact) || layout.frame.tables.length !== 1 ||
    table === undefined || table.columns.length === 0 || table.columns.length > 16 ||
    layout.frame.relationships.length !== 0 || layout.frame.foreignKeys.some(key => key.kind !== "scopeAuthorityForeignKey")) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  // SAFETY: only this WeakMap authenticates the inert profile token.
  const profile = Object.freeze({}) as CommerceProfile;
  const capturedInitialization = Object.freeze({ stepId, datasetSha256, expectedRowCount });
  const contract = yield* capturePrivateCanonicalValue({ format: "flarex.commerce-profile-contract", version: 1,
    artifact: { ...artifact.identity }, layoutSha256: layout.layoutSha256, profileId, initialization: capturedInitialization }, 4096,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  profiles.set(profile, Object.freeze({ artifact, layout, profileId, initialization: capturedInitialization, contractSha256: contract.sha256Hex }));
  return profile;
});

export const requireCommerceProfile = Effect.fn("CommerceProfile.require")(function* (profile: CommerceProfile) {
  const state = profiles.get(profile);
  if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  return state;
});

export function matchesCommerceProfile(profile: CommerceProfile | undefined, artifact: FrameworkSchemaArtifact, layout: RelationalPhysicalLayout): boolean {
  const state = profile === undefined ? undefined : profiles.get(profile);
  return state !== undefined && state.artifact.canonicalJson === artifact.canonicalJson && state.layout.canonicalJson === layout.canonicalJson;
}
export function matchesCommerceMigrationPlan(profile: CommerceProfile | undefined, plan: RelationalMigrationPlan): boolean {
  const state = profile === undefined ? undefined : profiles.get(profile);
  return state !== undefined && plan.frame.version === 1 &&
    sameArtifactIdentity(state.artifact.identity, plan.frame.artifact) && state.layout.canonicalJson === plan.physicalLayout.canonicalJson;
}
