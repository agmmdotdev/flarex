import { Effect, Option, Result, Schema } from "effect";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { CoreApplicationReadOperations, CoreNativeBindingMetadata } from "../../core/api";
import { PrivateReferencePermissions } from "../../execution/journal/privatePermissionEvidence";
import type { PrivateReadPrincipal } from "../../execution/journal/privateReadAccess";
import { boundedRequestRootIdentity } from "../../execution/preparation/boundedRequestLifetime";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import type { NativeCmsWriteAuthorization } from "./nativeDocuments";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError } from "./model";
import { nativeResult } from "./nativeFailure";

const StoredPermissions = Schema.Struct({ _id: DeveloperDocumentIdSchema, _creationTime: Schema.Number,
  policy: PrivateReferencePermissions });
const decodeStored = Schema.decodeUnknownEffect(StoredPermissions, { onExcessProperty: "error" });
declare const referenceAccessBrand: unique symbol;
/** This exact root's tracked Application read, never a caller-provided policy. */
export interface NativeReferenceSaveAccess { readonly [referenceAccessBrand]: true }
interface ReferenceAccess {
  readonly root: object;
  readonly lifetime: CmsRequestLifetime;
  readonly collection: string;
  readonly table: string;
  readonly field: string;
  readonly configSha256: string;
  readonly provenanceSha256: string;
  readonly permissions: typeof PrivateReferencePermissions.Type;
}
const accesses = new WeakMap<object, ReferenceAccess>();
const referenceTarget = (state: ReferenceAccess, document: JsonObject | null): Result.Result<string | null, ReturnType<typeof cmsError>> => {
  const value = document?.[state.field];
  return value == null ? Result.succeed(null) : typeof value === "string" ? Result.succeed(value) : Result.fail(cmsError("storedCorruption"));
};

export const prepareNativeReferenceSaveAccess = Effect.fn("NativeReferenceSave.prepareAccess")(function* (input: Readonly<{
  application: CoreApplicationReadOperations; policyDocumentId: string; principal: PrivateReadPrincipal;
  native: CoreNativeBindingMetadata; collection: string; table: string; field: string; lifetime: CmsRequestLifetime; transactionId: string;
}>) {
  const root = boundedRequestRootIdentity(input.lifetime);
  const principal = Object.freeze({ ...input.principal });
  if (root === undefined || input.lifetime.isClosing()
    || projectScopeIdUuidV1(principal.scopeId).scopeUuid !== input.native.definition.identity.scopeUuid
    || !input.native.tables.some(table => table.name === input.table
      && table.nativePolicy?.protectedReferences?.some(reference => reference.sourceTable === table.name && reference.field === input.field)))
    return yield* cmsError("invalidAuthority");
  const observed = yield* input.lifetime.operation(input.lifetime.context, input.transactionId, "read",
    nativeResult(input.application.get(input.policyDocumentId)));
  if (Option.isNone(observed)) return yield* cmsError("invalidAuthority");
  const stored = yield* decodeStored(observed.value).pipe(Effect.mapError(cause => cmsError("storedCorruption", cause)));
  const policy = stored.policy;
  if (stored._id !== input.policyDocumentId || policy.principal.scopeId !== principal.scopeId
    || policy.principal.principalDigest !== principal.principalDigest || policy.collection !== input.collection || policy.relation !== input.field)
    return yield* cmsError("invalidAuthority");
  const permissions = Object.freeze({ ...policy, principal: Object.freeze({ ...policy.principal }), source: Object.freeze({ ...policy.source }),
    assign: Object.freeze([...policy.assign]), retain: Object.freeze([...policy.retain]) });
  // SAFETY: the only issuer observed this policy point through the confined
  // Application child of the exact native root and authenticated its principal.
  const token = Object.freeze({}) as NativeReferenceSaveAccess;
  accesses.set(token, Object.freeze({ root, lifetime: input.lifetime, collection: input.collection, table: input.table, field: input.field,
    configSha256: input.native.definition.identity.configSha256, provenanceSha256: input.native.definition.identity.provenanceSha256, permissions }));
  return token;
});

export function inspectNativeReferenceSaveAccess(access: NativeReferenceSaveAccess, lifetime: CmsRequestLifetime) {
  const selected = accesses.get(access);
  return selected !== undefined && selected.root === boundedRequestRootIdentity(lifetime) && !selected.lifetime.isClosing()
    ? Object.freeze({ collection: selected.collection, table: selected.table, field: selected.field,
      configSha256: selected.configSha256, provenanceSha256: selected.provenanceSha256, source: selected.permissions.source }) : undefined;
}

/** Authorization sees the effective normalized transition. Core still owns
 * data validation, integrity/liveness, observations, pending state and settlement. */
export function makeNativeReferenceAuthorization(access: NativeReferenceSaveAccess,
  lifetime: CmsRequestLifetime): NativeCmsWriteAuthorization {
  const histories = new Map<string, { original: string | null; previous: readonly (string | null)[] }>();
  const selected = () => {
    const state = accesses.get(access);
    return state !== undefined && state.root === boundedRequestRootIdentity(lifetime) && !state.lifetime.isClosing() ? state : undefined;
  };
  const fields = (value: unknown) => Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(value, lifetime.remainingBytes(), cmsError);
    if (!isJsonObject(captured.value)) return yield* Result.fail(cmsError("invalidInput"));
    return captured.value;
  });
  const authorize = (operation: "create" | "update" | "delete", table: string | undefined,
    original: string | null, before: string | null, after: string | null, history: readonly (string | null)[]) => Result.gen(function* () {
    const state = selected();
    if (state === undefined || state.table !== table || !state.permissions.source[operation]) return yield* Result.fail(cmsError("invalidAuthority"));
    if (after === null) return;
    const retained = operation !== "create" && original === after && before === after && history.every(value => value === original);
    if (!(retained ? state.permissions.retain : state.permissions.assign).includes(after)) return yield* Result.fail(cmsError("invalidAuthority"));
  });
  return Effect.fn("NativeReferenceSave.authorizeTransition")(function* (transition) {
    const state = selected();
    if (state === undefined || state.table !== transition.table) return yield* cmsError("invalidAuthority");
    const before = yield* Effect.fromResult(referenceTarget(state, transition.before));
    const afterDocument = transition.operation === "delete" ? null : yield* Effect.fromResult(fields(transition.fields));
    const after = yield* Effect.fromResult(referenceTarget(state, transition.operation === "patch"
      ? { ...transition.before, ...afterDocument } : afterDocument));
    const history = transition.id === undefined ? { original: null, previous: [] }
      : histories.get(transition.id) ?? { original: before, previous: [] };
    yield* Effect.fromResult(authorize(transition.operation === "insert" ? "create"
      : transition.operation === "delete" ? "delete" : "update", transition.table, history.original, before, after, history.previous));
    return (documentId: string): void => {
      histories.set(documentId, { original: history.original, previous: [...history.previous, before, after] });
    };
  });
}
