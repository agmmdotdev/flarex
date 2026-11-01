import { Effect, Option, Schema } from "effect";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { CoreApplicationReadOperations, CoreNativeBindingMetadata, CoreNativeOperations } from "../../core/api";
import { PrivateReverseReadPermissions } from "../../execution/journal/privateReverseReadEvidence";
import { MAX_PRIVATE_READ_IDS, type PrivateReadPrincipal } from "../../execution/journal/privateReadAccess";
import { boundedRequestRootIdentity } from "../../execution/preparation/boundedRequestLifetime";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError, cmsLimits, type CmsTransactionError } from "./model";
import { nativeResult } from "./nativeFailure";

// Same separate read-policy contract, with the selected Core's canonical source
// ID grammar. This is not a decoder for retained Legacy policy identities.
const ReadPermissions = Schema.Struct({ ...PrivateReverseReadPermissions.fields,
  articles: Schema.Array(DeveloperDocumentIdSchema).check(Schema.isMaxLength(MAX_PRIVATE_READ_IDS)) });
const Stored = Schema.Struct({ _id: DeveloperDocumentIdSchema, _creationTime: Schema.Number, policy: ReadPermissions });
const decodeStored = Schema.decodeUnknownEffect(Stored, { onExcessProperty: "error" });
const Page = Schema.Struct({ limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: cmsLimits.pageRows })),
  cursor: Schema.optionalKey(Schema.NonEmptyString) });
const decodePage = Schema.decodeUnknownEffect(Page, { onExcessProperty: "error" });
declare const pagesBrand: unique symbol;
export interface NativeReferencePagesAccess { readonly [pagesBrand]: true }
interface Position { readonly buffer: readonly string[]; readonly source: Uint8Array | null; readonly done: boolean; readonly generation: number }
interface Access {
  readonly root: object; readonly lifetime: CmsRequestLifetime; readonly operations: CoreNativeOperations;
  readonly collection: string; readonly table: string; readonly reference: string; readonly target: string;
  readonly articleIds: readonly string[]; readonly configSha256: string; readonly provenanceSha256: string;
  readonly cursors: Map<string, Position>; inspected: number;
}
const accesses = new WeakMap<object, Access>();

/** Target visibility is a separate genuine native read selected by the trusted
 * backend. Neither assignment nor enumeration substitutes for that read. */
export const prepareNativeReferencePagesAccess = Effect.fn("NativeReferencePages.prepareAccess")(function* (input: Readonly<{
  application: CoreApplicationReadOperations; policyDocumentId: string; principal: PrivateReadPrincipal;
  native: CoreNativeBindingMetadata; operations: CoreNativeOperations; lifetime: CmsRequestLifetime; transactionId: string;
  collection: string; table: string; field: string; targetId: string;
  readTarget: Effect.Effect<Json, CmsTransactionError>;
}>) {
  const root = boundedRequestRootIdentity(input.lifetime);
  const reference = input.native.tables.find(table => table.name === input.table)?.nativePolicy?.protectedReferences
    ?.find(candidate => candidate.sourceTable === input.table && candidate.field === input.field);
  if (root === undefined || input.lifetime.isClosing() || reference === undefined
    || projectScopeIdUuidV1(input.principal.scopeId).scopeUuid !== input.native.definition.identity.scopeUuid)
    return yield* cmsError("invalidAuthority");
  const observed = yield* input.lifetime.operation(input.lifetime.context, input.transactionId, "read",
    nativeResult(input.application.get(input.policyDocumentId)));
  if (Option.isNone(observed)) return yield* cmsError("invalidAuthority");
  const stored = yield* decodeStored(observed.value).pipe(Effect.mapError(cause => cmsError("storedCorruption", cause)));
  const policy = stored.policy;
  if (stored._id !== input.policyDocumentId || policy.principal.scopeId !== input.principal.scopeId
    || policy.principal.principalDigest !== input.principal.principalDigest || policy.collection !== input.collection
    || policy.relation !== input.field || !policy.enumerate.includes(input.targetId)) return yield* cmsError("invalidAuthority");
  const target = yield* input.readTarget;
  if (!isJsonObject(target) || target.id !== input.targetId) return yield* cmsError("invalidAuthority");
  // SAFETY: only this issuer authenticates the root, tracked permission point
  // and distinct native target disclosure before registering the inert token.
  const token = Object.freeze({}) as NativeReferencePagesAccess;
  accesses.set(token, { root, lifetime: input.lifetime, operations: input.operations, collection: input.collection,
    table: input.table, reference: reference.reference.name, target: input.targetId, articleIds: Object.freeze([...policy.articles]),
    configSha256: input.native.definition.identity.configSha256, provenanceSha256: input.native.definition.identity.provenanceSha256,
    cursors: new Map(), inspected: 0 });
  return token;
});

export function inspectNativeReferencePagesAccess(access: NativeReferencePagesAccess, lifetime: CmsRequestLifetime) {
  const state = accesses.get(access);
  return state !== undefined && state.root === boundedRequestRootIdentity(lifetime) && !state.lifetime.isClosing()
    ? Object.freeze({ collection: state.collection, table: state.table, articleIds: state.articleIds,
      configSha256: state.configSha256, provenanceSha256: state.provenanceSha256 }) : undefined;
}

export const readNativeReferencePage = Effect.fn("NativeReferencePages.page")(function* (
  access: NativeReferencePagesAccess, lifetime: CmsRequestLifetime, input: Readonly<{ limit: number; cursor?: string }>,
) {
  const state = accesses.get(access);
  if (state === undefined || state.root !== boundedRequestRootIdentity(lifetime) || state.lifetime.isClosing())
    return yield* cmsError("invalidAuthority");
  const page = yield* decodePage(input).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
  const previous = page.cursor === undefined ? undefined : state.cursors.get(page.cursor);
  if (page.cursor !== undefined && previous === undefined) return yield* cmsError("invalidAuthority");
  if (previous !== undefined) yield* nativeResult(state.operations.assertProtectedReferenceGeneration(state.reference, previous.generation));
  const allowed = new Set(state.articleIds), visible = [...(previous?.buffer ?? [])];
  let source = previous?.source ?? null, done = previous?.done ?? false, generation = previous?.generation;
  while (visible.length <= page.limit && !done) {
    const window = yield* nativeResult(state.operations.protectedReferencePage(state.reference, state.target, { limit: cmsLimits.pageRows,
      ...(source === null ? {} : { position: source }), ...(generation === undefined ? {} : { generation }) }));
    state.inspected += window.inspectedMemberships;
    if (state.inspected > cmsLimits.identities) return yield* cmsError("limitExceeded");
    yield* lifetime.fromResult(lifetime.charge(128 + window.inspectedMemberships * 64));
    for (const id of window.ids) if (allowed.has(id)) visible.push(id);
    generation = window.generation; source = window.position; done = !window.hasMore;
    if (!done && source === null) return yield* cmsError("storedCorruption");
  }
  const ids = visible.slice(0, page.limit), lookahead = visible[page.limit] ?? null;
  const hasMore = lookahead !== null;
  let cursor: string | null = null;
  if (hasMore && generation !== undefined) {
    cursor = crypto.randomUUID();
    yield* lifetime.fromResult(lifetime.charge(256 + (source?.byteLength ?? 0) + visible.length * 64));
    state.cursors.set(cursor, Object.freeze({ source: source?.slice() ?? null, done, generation,
      buffer: Object.freeze(visible.slice(page.limit)) }));
  }
  return Object.freeze({ ids: Object.freeze(ids), lookahead, hasMore, cursor });
});
