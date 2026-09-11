import { captureCommerceResources, defaultCommerceResources, type CommerceResources } from "./resources";
import { Effect, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import type { FrameworkSchemaArtifact, FrameworkSchemaArtifactIdentity } from "../frameworkSchema/artifact/model";
import { copyCapturedFrameworkSchemaArtifactEvidence } from "../frameworkSchema/artifact/canonical";
import { isCapturedRelationalPhysicalLayout } from "../relationalSchema/physical/canonical";
import type { RelationalPhysicalLayout } from "../relationalSchema/physical/model";
import type { RelationalMigrationPlan } from "../migrationCoordination/model";
import { commerceError, commerceLimits } from "./model";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";
import { capturePrivateJsonData } from "../privateJsonData";
import { selectRelationalRowKey } from "../commitPublication/relationalRowKey";

declare const commerceProfileBrand: unique symbol;
export interface CommerceProfile { readonly [commerceProfileBrand]: true }
declare const commerceSchemaProfileBrand: unique symbol;
export interface CommerceSchemaProfile { readonly [commerceSchemaProfileBrand]: true }
export type CommerceInstallationProfile = CommerceProfile | CommerceSchemaProfile;
const schemaProfiles = new WeakMap<object, Readonly<{ artifact: FrameworkSchemaArtifact; layout: RelationalPhysicalLayout }>>();

export function commerceSchemaPlanStepLimit(profile: CommerceInstallationProfile | undefined): number {
  return profile !== undefined && (schemaProfiles.has(profile) || profiles.get(profile)?.localOnly === true) ? 128 : 15;
}

/** Trusted schema composition; this token grants no command, binding or seed authority. */
export const registerCommerceSchemaProfile = Effect.fn("CommerceProfile.registerSchema")(function* (
  artifact: FrameworkSchemaArtifact, layout: RelationalPhysicalLayout,
) {
  if (copyCapturedFrameworkSchemaArtifactEvidence(artifact) === undefined || !isCapturedRelationalPhysicalLayout(layout) ||
    artifact.identity.owner !== "medusa" || artifact.provenance.kind !== "sourceSnapshot" || artifact.dependencies.length !== 0 ||
    !sameArtifactIdentity(artifact.identity, layout.frame.artifact)) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  // SAFETY: only this registry authenticates the opaque schema-installation token.
  const profile = Object.freeze({}) as CommerceSchemaProfile;
  schemaProfiles.set(profile, Object.freeze({ artifact, layout }));
  return profile;
});
export interface CommerceProfileState {
  readonly artifact: FrameworkSchemaArtifact;
  readonly layout: RelationalPhysicalLayout;
  readonly profileId: string;
  readonly initialization: Readonly<{ stepId: string; datasetSha256: string; expectedRowCount: number }> | null;
  readonly tables: readonly CommerceTableCapability[];
  readonly localOnly: boolean;
  readonly contractSha256: string;
  readonly resources: CommerceResources;
}
export interface CommerceTableCapability {
  readonly tableId: string;
  readonly keyId: string;
  readonly mode: "scalar" | "readInsert" | "readInsertUpdate";
  readonly referenceColumns?: readonly string[];
  readonly remove?: "declaredKey";
  readonly lifecycle?: "managedSoftDelete";
  readonly upsert?: "activeRow";
  readonly observeRows?: true;
}
const LocalTableAdmission = Schema.Struct({
  tableId: Schema.String, keyId: Schema.String,
  update: Schema.optional(Schema.Literal("existingPrimaryKey")),
  referenceColumns: Schema.optional(Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(16))),
  remove: Schema.optional(Schema.Literal("declaredKey")),
  lifecycle: Schema.optional(Schema.Literal("managedSoftDelete")),
  upsert: Schema.optional(Schema.Literal("activeRow")),
  observeRows: Schema.optional(Schema.Literal(true)),
});
export type LocalCommerceTableAdmission = typeof LocalTableAdmission.Type;
const decodeLocalTables = Schema.decodeUnknownEffect(Schema.Array(LocalTableAdmission).check(Schema.isMinLength(1), Schema.isMaxLength(16)), { onExcessProperty: "error" });
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
    table.columns.some(column => column.type === "boolean") || table.checks.some(check => check.kind !== "integerRange") ||
    table.indexes.some(index => index.kind !== "btree") || table.keys.filter(key => key.kind === "primary").length !== 1 ||
    layout.frame.relationships.length !== 0 || layout.frame.foreignKeys.some(key => key.kind !== "scopeAuthorityForeignKey")) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  // SAFETY: only this WeakMap authenticates the inert profile token.
  const profile = Object.freeze({}) as CommerceProfile;
  const capturedInitialization = Object.freeze({ stepId, datasetSha256, expectedRowCount });
  const contract = yield* capturePrivateCanonicalValue({ format: "flarex.commerce-profile-contract", version: 1,
    artifact: { ...artifact.identity }, layoutSha256: layout.layoutSha256, profileId, initialization: capturedInitialization }, 4096,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const primary = table.keys.find(key => key.kind === "primary");
  if (primary === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  profiles.set(profile, Object.freeze({ artifact, layout, profileId, initialization: capturedInitialization, contractSha256: contract.sha256Hex,
    localOnly: false, resources: defaultCommerceResources, tables: Object.freeze([Object.freeze({ tableId: table.identity.tableId, keyId: primary.identity.keyId, mode: "scalar" as const })]) }));
  return profile;
});

/** Source-private local conformance issuer. Ordinary hosts refuse this profile. */
export const registerLocalCommerceProfile = Effect.fn("CommerceProfile.registerLocal")(function* (
  artifact: FrameworkSchemaArtifact, layout: RelationalPhysicalLayout, profileId: string,
  capabilities: readonly LocalCommerceTableAdmission[],
  resourceContract?: CommerceResources,
) {
  yield* registerCommerceSchemaProfile(artifact, layout);
  const resources = resourceContract === undefined ? defaultCommerceResources : yield* Effect.fromResult(captureCommerceResources(resourceContract));
  const captured = yield* Effect.fromResult(capturePrivateJsonData(capabilities, 16_384, commerceError));
  if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(profileId)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const entries = yield* decodeLocalTables(captured.value).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const tables: CommerceTableCapability[] = [];
  for (const entry of entries) {
    if (tables.some(table => table.tableId === entry.tableId)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const key = yield* Effect.fromResult(selectRelationalRowKey(layout, entry.tableId, entry.keyId)).pipe(Effect.mapError(() => commerceError("unsupportedProfile")));
    if (entry.update !== undefined && key.kind !== "primary") return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (entry.lifecycle !== undefined || entry.upsert !== undefined) {
      const deletion = layout.frame.requiredPhysicalCapabilities.filter(item => item.kind === "softDelete" && item.deletedAtColumn.identity.tableId === entry.tableId);
      const timestamps = layout.frame.requiredPhysicalCapabilities.filter(item => item.kind === "managedTimestamps" && item.updatedAtColumn.identity.tableId === entry.tableId);
      if (key.kind !== "primary" || deletion.length !== 1 || timestamps.length !== 1)
        return yield* Effect.fail(commerceError("unsupportedProfile"));
    }
    if (entry.remove !== undefined && !(key.kind === "primary" || (key.kind === "unique" && key.columns.length === 3)))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const referenceColumns: string[] = [];
    if (entry.referenceColumns !== undefined) {
      if (entry.update === undefined || !Array.isArray(entry.referenceColumns) || entry.referenceColumns.length === 0 || entry.referenceColumns.length > 16)
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const table = layout.frame.tables.find(candidate => candidate.identity.tableId === entry.tableId);
      for (const name of entry.referenceColumns) {
        const field = table?.columns.find(column => column.identity.columnId === name);
        const references = layout.frame.foreignKeys.filter(fk => fk.kind === "foreignKey" && fk.sourceTable.tableId === entry.tableId &&
          fk.sourceColumns.length === 2 && fk.sourceColumns[0] === "scope_uuid" && fk.sourceColumns[1] === field?.name);
        if (typeof name !== "string" || field === undefined || field.type !== "text" || key.columns.includes(field.name) || references.length !== 1 || referenceColumns.includes(name))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        const reference = references[0];
        if (reference?.kind !== "foreignKey" || reference.targetColumns[0] !== "scope_uuid" || !layout.frame.tables.some(target => target.identity.tableId === reference.targetTable.tableId &&
          target.keys.some(targetKey => targetKey.columns.length === reference.targetColumns.length && targetKey.columns.every((column, index) => column === reference.targetColumns[index]))))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        referenceColumns.push(name);
      }
      referenceColumns.sort(compareUtf16Strings);
    }
    tables.push(Object.freeze({ tableId: entry.tableId, keyId: entry.keyId, mode: entry.update === undefined ? "readInsert" : "readInsertUpdate",
      ...(entry.referenceColumns === undefined ? {} : { referenceColumns: Object.freeze(referenceColumns) }),
      ...(entry.remove === undefined ? {} : { remove: "declaredKey" as const }),
      ...(entry.lifecycle === undefined ? {} : { lifecycle: "managedSoftDelete" as const }),
      ...(entry.upsert === undefined ? {} : { upsert: entry.upsert }),
      ...(entry.observeRows === undefined ? {} : { observeRows: true as const }),
    }));
  }
  tables.sort((left, right) => compareUtf16Strings(left.tableId, right.tableId));
  const contract = yield* capturePrivateCanonicalValue({ format: "flarex.commerce-profile-contract",
    version: resourceContract !== undefined ? 6 : tables.some(table => table.lifecycle !== undefined) ? 5 : tables.some(table => table.referenceColumns !== undefined || table.remove !== undefined) ? 4 : tables.some(table => table.mode === "readInsertUpdate") ? 3 : 2,
    artifact: { ...artifact.identity }, layoutSha256: layout.layoutSha256, profileId, initialization: null,
    localEventPolicy: "buffer-until-confirmed-commit",
    ...(tables.some(table => table.lifecycle !== undefined) ? { lifecycleBehavior: "observe-unchanged-restore" } : {}),
    ...(resourceContract === undefined ? {} : { resources }), tables: tables.map(table => ({ ...table })) }, 16_384,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  // SAFETY: only this registry issues the exact opaque local profile.
  const profile = Object.freeze({}) as CommerceProfile;
  profiles.set(profile, Object.freeze({ artifact, layout, profileId, initialization: null, localOnly: true, resources,
    tables: Object.freeze(tables), contractSha256: contract.sha256Hex }));
  return profile;
});

export const requireCommerceProfile = Effect.fn("CommerceProfile.require")(function* (profile: CommerceProfile) {
  const state = profiles.get(profile);
  if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  return state;
});

export function matchesCommerceProfile(profile: CommerceInstallationProfile | undefined, artifact: FrameworkSchemaArtifact, layout: RelationalPhysicalLayout): boolean {
  const state = profile === undefined ? undefined : profiles.get(profile) ?? schemaProfiles.get(profile);
  return state !== undefined && state.artifact.canonicalJson === artifact.canonicalJson && state.layout.canonicalJson === layout.canonicalJson;
}
export function matchesCommerceMigrationPlan(profile: CommerceInstallationProfile | undefined, plan: RelationalMigrationPlan): boolean {
  const state = profile === undefined ? undefined : profiles.get(profile) ?? schemaProfiles.get(profile);
  return state !== undefined && plan.frame.version === 1 &&
    sameArtifactIdentity(state.artifact.identity, plan.frame.artifact) && state.layout.canonicalJson === plan.physicalLayout.canonicalJson;
}
