import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { Effect, Option, Schema } from "effect";
import { appDocumentIdV1FromRowIdentity, decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { readAcceptedApplicationBinding } from "../applicationActivation";
import type { ApplicationRelationReadPort, ApplicationRelationReadCapability } from "../applicationRelationRead";
import { readIncomingAppRelationEdgePageInTransactionEffect, type ReadIncomingAppRelationEdgePageInput } from "../appRelationEdges";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import type { CmsRequestLifetime } from "./lifetime";
import type { CmsDocuments } from "./documents";
import { cmsError, type CmsRequestContext, type CmsPresentedTransactionId, type CmsTransactionError } from "./model";

export type CmsIncomingSource = "relatedPost" | "relatedPosts";
export interface CmsRelations {
  readonly incoming: (context: CmsRequestContext, id: CmsPresentedTransactionId, source: CmsIncomingSource,
    target: string, limit: number) => Effect.Effect<Readonly<{ docs: readonly string[]; hasNextPage: boolean }>, CmsTransactionError>;
}

type NativeReadFailure = Effect.Error<ReturnType<ApplicationRelationReadPort["prepareBySource"]>> |
  Effect.Error<ReturnType<ApplicationRelationReadPort["validateInTransaction"]>>;
/** Preserve native corruption and storage failures when projecting into the CMS domain. */
export function cmsRelationReadFailure(cause: NativeReadFailure, mismatch: "invalidAuthority" | "bindingChanged"): CmsTransactionError {
  if (cause._tag.includes("Corruption") || ("reason" in cause && (cause.reason === "storedState" || cause.reason === "storedCorruption"))) return cmsError("storedCorruption", cause);
  if ("reason" in cause && cause.reason === "resourceFailure") return cmsError("resourceFailure", cause);
  if (cause._tag === "ApplicationRelationReadUnavailableError" || cause._tag === "ApplicationActivationError" ||
    cause._tag === "ApplicationRelationReadinessFoldError" || cause._tag === "TrustedScopeAuthorityResolutionError") return cmsError(mismatch, cause);
  return cmsError("resourceFailure", cause);
}

const decodeDeployment = Schema.decodeUnknownEffect(TransactionGrantDeploymentIdV1Schema);

/** Preparation reuses the native owner; no relation authority comes from command arguments. */
export const prepareCmsRelations = Effect.fn("CmsRelations.prepare")(function* (
  admission: CmsAdmission, port: ApplicationRelationReadPort | undefined,
) {
  const state = yield* requireCmsAdmission(admission);
  if (state.configuration.profile !== "payload.content-joins") return Option.none();
  const basis = yield* Effect.fromResult(readAcceptedApplicationBinding(state.binding, state.tx, state.clock))
    .pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const manifest = basis.manifest;
  const deploymentId = yield* decodeDeployment(basis.deploymentId).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  if (port === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  const input = { deploymentId, scopeId: basis.authority.scopeId, schemaVersionId: basis.schemaVersionId };
  const capabilities = new Map<CmsIncomingSource, ApplicationRelationReadCapability>();
  for (const relation of manifest.schema.relations) {
    const name = relation.declaration.source.forwardName;
    if (name !== "relatedPost" && name !== "relatedPosts") return yield* Effect.fail(cmsError("unsupportedProfile"));
    const capability = yield* port.prepareAcceptedBySource({ deploymentId, binding: state.binding, tx: state.tx, clock: state.clock,
      relation: { source: relation.declaration.source } }).pipe(Effect.mapError(cause => cmsRelationReadFailure(cause, "invalidAuthority")));
    capabilities.set(name === "relatedPost" ? "relatedPost" : "relatedPosts", capability);
  }
  return Option.some({ port, input, capabilities });
});

/** Request-owned instance: all work runs under the existing CMS admission and lock. */
export const makeCmsRelations = Effect.fn("CmsRelations.make")(function* (
  prepared: Effect.Success<ReturnType<typeof prepareCmsRelations>>, admission: CmsAdmission,
  lifetime: CmsRequestLifetime, documents: CmsDocuments, standalone: boolean,
  observeQuery?: ReadIncomingAppRelationEdgePageInput["observeQuery"],
) {
  yield* requireCmsAdmission(admission);
  let windows = 0;
  let inspected = 0;
  const incoming: CmsRelations["incoming"] = Effect.fn("CmsRelations.incoming")(function* (context, id, source, target, limit) {
    if (!standalone || context !== lifetime.context || Option.isNone(prepared)) return yield* lifetime.operation(context, id, "read", Effect.fail(cmsError("invalidAuthority")));
    const native = prepared.value;
    // The document capability authenticates request, table and liveness before native access.
    const root = yield* documents.get(context, id, target);
    return yield* lifetime.operation(context, id, "read", Effect.gen(function* () {
      const state = yield* requireCmsAdmission(admission);
      if (root === null) return yield* Effect.fail(cmsError("documentMissing"));
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) return yield* Effect.fail(cmsError("invalidInput"));
      const capability = native.capabilities.get(source);
      if (capability === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
      const resolved = yield* Effect.fromResult(native.port.resolve(capability, native.input))
        .pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(target))
        .pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      if (identity.tableId !== resolved.definition.binding.targetTableId || resolved.epoch !== state.clock.epoch ||
        resolved.storageGenerationFence !== state.clock.storageGenerationFence) return yield* Effect.fail(cmsError("invalidAuthority"));
      yield* native.port.validateInTransaction(capability, native.input, state.tx, state.clock)
        .pipe(Effect.mapError(cause => cmsRelationReadFailure(cause, "bindingChanged")));
      if (++windows > 64) return yield* Effect.fail(cmsError("limitExceeded"));
      yield* Effect.fromResult(lifetime.charge((limit + 1) * 128));
      const page = yield* readIncomingAppRelationEdgePageInTransactionEffect(state.tx, { scopeId: state.authority.scopeId,
        definition: resolved.definition.edge, targetRowId: identity.rowId, maximumIdentities: limit, ...(observeQuery === undefined ? {} : { observeQuery }) })
        .pipe(Effect.mapError(cause => cmsError(cause._tag === "AppRelationEdgeCorruptionError" ? "storedCorruption" : "statementFailure", cause)));
      inspected += page.inspectedBaseOccurrenceCount;
      if (inspected > 1088) return yield* Effect.fail(cmsError("limitExceeded"));
      if (page.versionBefore !== page.versionAfter || page.versionAfter > state.clock.lastCommitSeq) return yield* Effect.fail(cmsError("storedCorruption"));
      return Object.freeze({ docs: Object.freeze(page.items.map(item => appDocumentIdV1FromRowIdentity({
        tableId: resolved.definition.binding.sourceTableId, rowId: item.sourceRowId }))), hasNextPage: !page.exhausted });
    }));
  });
  return Object.freeze({ incoming } satisfies CmsRelations);
});
