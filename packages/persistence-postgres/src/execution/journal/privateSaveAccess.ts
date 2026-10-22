import { Data, Effect, Option, Result, Schema } from "effect";
import { isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { inspectLogicalParticipantAdmissionBundle, inspectLogicalParticipantAttemptAdmission, issueLogicalParticipantAdmissionBundle } from
  "../../storage/documents/logicalDocuments/participantAdmission";
import { inspectLogicalDocumentAttemptConfiguration } from "../../storage/documents/logicalDocuments/documentAdmission";
import { LogicalParticipantInvocationError } from "../../storage/documents/logicalDocuments/participantErrors";
import { requireFiniteAttemptPreparationOpen, requireFiniteProductReference } from "../../storage/documents/logicalDocuments/sourceAdmission";
import { reserveLogicalDocumentRootBytes } from "../../storage/documents/logicalDocuments/rootEvaluator";
import type { LogicalDocumentWorkingSetInput } from "../../storage/documents/logicalDocuments/model";
import { inspectPrivateReferencePermissionEvidence, type PrivateReferencePermissionEvidence } from "./privatePermissionEvidence";
import { PrivateReadPrincipal } from "./privateReadAccess";
import type { LogicalParticipantBorrow, LogicalParticipantBorrowBase, SessionJournalAttempt, SessionJournalStorePersistence } from "./contracts";
import type { JournalAttemptOwner } from "./attemptOwner";
import { discardFiniteRootEvidence } from "./finiteRoot";

const Selection = Schema.Struct({ participant: Schema.NonEmptyString, collection: Schema.NonEmptyString, relation: Schema.NonEmptyString,
  nativeProfileRevision: PrivateReadPrincipal.fields.principalDigest });
export type PrivateReferenceSaveSelection = typeof Selection.Type;
const decodeSelection = Schema.decodeUnknownEffect(Selection, { onExcessProperty: "error" });
export class PrivateSaveAccessError extends Data.TaggedError("PrivateSaveAccessError")<{
  readonly reason: "invalidAuthority" | "denied" | "storedCorruption" | "resourceFailure" | "limitExceeded";
  readonly cause?: unknown;
}> {}
declare const saveBrand: unique symbol;
export interface PrivateReferenceSaveAccess { readonly [saveBrand]: true }
type Fact = NonNullable<ReturnType<typeof inspectPrivateReferencePermissionEvidence>>;
interface SaveState {
  readonly attempt: SessionJournalAttempt;
  readonly evidence: PrivateReferencePermissionEvidence;
  readonly principal: typeof PrivateReadPrincipal.Type;
  readonly collection: string; readonly tableName: string; readonly field: string;
  readonly participant: string;
  readonly nativeProfileRevision: string;
  readonly configSha256: string; readonly provenanceSha256: string;
  readonly profileRevision: string;
  readonly admission: LogicalParticipantBorrowBase["bundle"];
  readonly methods: readonly string[];
  readonly isLive: () => boolean;
}
const saves = new WeakMap<object, SaveState>();
const refused = (reason: PrivateSaveAccessError["reason"], cause?: unknown) =>
  new PrivateSaveAccessError({ reason, ...(cause === undefined ? {} : { cause }) });
const inspect = (access: PrivateReferenceSaveAccess, attempt: SessionJournalAttempt): Readonly<{ state: SaveState; fact: Fact }> | undefined => {
  const state = saves.get(access);
  const fact = state?.attempt === attempt && state.isLive() ? inspectPrivateReferencePermissionEvidence(state.evidence, attempt, state.principal) : undefined;
  return state === undefined || fact === undefined ? undefined : { state, fact };
};

/** Only the journal's real finite root can derive this capability. Source
 * methods stay bounded by entry admission; facts stay tracked by SA1. */
export function makePrivateReferenceSaveOperations(owner: JournalAttemptOwner) {
  const preparePrivateReferenceSaveEffect: SessionJournalStorePersistence["preparePrivateReferenceSaveEffect"] =
    Effect.fn("PrivateReferenceSave.prepare")(function* (attempt, evidence, input) {
      const attempted = owner.readAttempt(attempt);
      const finite = attempted === undefined ? undefined : owner.readFiniteRoot(attempted);
      if (attempted === undefined || finite === undefined || finite.status !== "open") return yield* Effect.fail(refused("invalidAuthority"));
      const key = `${attempted.selector.scopeId}/${attempted.selector.sessionId}/${attempted.selector.attemptFence}`;
      return yield* Effect.gen(function* () {
        if (finite.commandWriter !== undefined || finite.inFlightOperations !== 0 || owner.isAdmittedOperationInFlight(key))
          return yield* Effect.fail(refused("invalidAuthority"));
        finite.inFlightOperations++;
        return yield* Effect.gen(function* () {
          const selection = yield* decodeSelection(input).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
          yield* Effect.fromResult(requireFiniteAttemptPreparationOpen(finite.metadata, attempt)).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
          if (Option.isNone(evidence)) return yield* Effect.fail(refused("denied"));
          const principal = { scopeId: attempted.selector.scopeId, principalDigest: finite.initialContext.principalDigest };
          const fact = inspectPrivateReferencePermissionEvidence(evidence.value, attempt, principal);
          const entry = finite.admissions.get(selection.participant);
          const methods = entry?.selection.operationMethods.filter(method => ["payload-create", "payload-update", "payload-delete"].includes(method)) ?? [];
          const first = methods[0];
          const parent = first === undefined || entry === undefined || entry.selection.profileRevision !== selection.nativeProfileRevision ? null :
            inspectLogicalParticipantAdmissionBundle(entry.bundle, attempt, selection.participant, first, selection.nativeProfileRevision);
          const admission = parent?.admissions[0];
          const source = admission === undefined || first === undefined ? null : inspectLogicalParticipantAttemptAdmission(admission, attempt, first);
          const document = admission === undefined || first === undefined ? undefined : inspectLogicalDocumentAttemptConfiguration(admission, attempt, first);
          const table = document?.configuration.tables.find(member => member.collectionSlug === selection.collection);
          if (fact === undefined || fact.permissions.collection !== selection.collection || fact.permissions.relation !== selection.relation ||
            parent === null || parent.admissions.length !== 1 || source === null || document === undefined || table === undefined ||
            source.metadata !== finite.metadata || !table.fields.some(field => field.name === selection.relation && field.kind === "text" && field.nullable === true))
            return yield* Effect.fail(refused("invalidAuthority"));
          yield* Effect.fromResult(requireFiniteProductReference(finite.metadata, attempt, source.sourceKey, table.logicalTableName, selection.relation))
            .pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
          const identity = yield* capturePrivateCanonicalValue({ format: "flarex.private-reference-save-access", version: 1,
            ...selection, ...document.contentIdentity, sourceKey: source.sourceKey, sourceSha256: source.sourceSha256,
            policyDocumentId: fact.documentId, policySha256: fact.policySha256, permissions: fact.permissions }, 1_048_576,
            { invalidInput: () => refused("invalidAuthority"), hashFailure: cause => refused("resourceFailure", cause) });
          if (finite.status !== "open" || finite.inFlightOperations !== 1 || finite.commandWriter !== undefined || owner.isAdmittedOperationInFlight(key) ||
            inspectPrivateReferencePermissionEvidence(evidence.value, attempt, principal) === undefined) return yield* Effect.fail(refused("invalidAuthority"));
          yield* Effect.fromResult(reserveLogicalDocumentRootBytes(finite.evaluator, { attempt, scopeId: principal.scopeId,
            snapshotCommitSeq: attempted.snapshotToken.commitSeq, attemptFence: attempted.selector.attemptFence.toString() }, identity.canonicalByteLength))
            .pipe(Effect.mapError(reason => refused(reason === "limitExceeded" ? "limitExceeded" : "invalidAuthority")));
          const selected = yield* Effect.fromResult(issueLogicalParticipantAdmissionBundle(attempt, { participant: selection.participant,
            operationMethods: methods, profileRevision: identity.sha256Hex, sources: [{ admission: parent.admissions[0]!, methods: parent.sourceMethods[0]! }] }))
            .pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
          // SAFETY: only this genuine attempt/permission/source issuer registers the inert token.
          const access = Object.freeze({}) as PrivateReferenceSaveAccess;
          saves.set(access, { attempt, evidence: evidence.value, principal, collection: selection.collection, tableName: table.logicalTableName,
            field: selection.relation, participant: selection.participant, nativeProfileRevision: selection.nativeProfileRevision,
            ...document.contentIdentity, profileRevision: identity.sha256Hex, admission: selected, methods,
            isLive: () => finite.status === "open" && Result.isSuccess(requireFiniteAttemptPreparationOpen(finite.metadata, attempt)) });
          return access;
        }).pipe(Effect.ensuring(Effect.sync(() => { finite.inFlightOperations--; })));
      }).pipe(Effect.onError(() => Effect.sync(() => { finite.status = "aborted"; discardFiniteRootEvidence(finite); })));
    });
  return { preparePrivateReferenceSaveEffect };
}

/** Safe adapter view. Assignment and retention lists stay with their issuer. */
export function inspectPrivateReferenceSaveAccess(access: PrivateReferenceSaveAccess, attempt: SessionJournalAttempt) {
  const selected = inspect(access, attempt);
  return selected === undefined ? undefined : Object.freeze({ collection: selected.state.collection, tableName: selected.state.tableName,
    participant: selected.state.participant, nativeProfileRevision: selected.state.nativeProfileRevision,
    field: selected.state.field, configSha256: selected.state.configSha256, provenanceSha256: selected.state.provenanceSha256,
    profileRevision: selected.state.profileRevision, admission: selected.state.admission,
    source: selected.fact.permissions.source });
}

const matches = (access: PrivateReferenceSaveAccess, input: LogicalParticipantBorrowBase) => {
  const selected = inspect(access, input.attempt);
  if (selected === undefined || input.bundle !== selected.state.admission || !selected.state.methods.includes(input.method)) return false;
  const bundle = inspectLogicalParticipantAdmissionBundle(input.bundle, input.attempt, selected.state.participant, input.method, selected.state.profileRevision);
  return bundle !== null && bundle.admissions.length === input.admissions.length &&
    bundle.admissions.every((admission, index) => admission === input.admissions[index]);
};
export const bindPrivateReferenceSaveAccess = (access: PrivateReferenceSaveAccess, borrow: LogicalParticipantBorrow): LogicalParticipantBorrow =>
  Effect.fn("PrivateReferenceSave.borrow")(function* (input) {
    if (!matches(access, input)) return yield* Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: refused("invalidAuthority") }));
    return yield* borrow({ ...input, privateReferenceSave: access });
  });

/** CMS installs this pure decision at the existing effective-transition owner. */
export function requirePrivateReferenceSaveTransition(access: PrivateReferenceSaveAccess, input: LogicalParticipantBorrowBase,
  identity: Readonly<{ configSha256: string; provenanceSha256: string }>) {
  return Result.gen(function* () {
    const selected = inspect(access, input.attempt);
    if (selected === undefined || !matches(access, input) || selected.state.configSha256 !== identity.configSha256 ||
      selected.state.provenanceSha256 !== identity.provenanceSha256) return yield* Result.fail(refused("invalidAuthority"));
    const target = (document: CanonicalFlarexValueV1 | null): Result.Result<string | null, PrivateSaveAccessError> => {
      if (document === null) return Result.succeed(null);
      if (!isCanonicalFlarexRuntimeObjectV1(document.value)) return Result.fail(refused("storedCorruption"));
      const value = document.value[selected.state.field];
      return value == null ? Result.succeed(null) : typeof value === "string" ? Result.succeed(value) : Result.fail(refused("storedCorruption"));
    };
    const authorize: NonNullable<LogicalDocumentWorkingSetInput<PrivateSaveAccessError>["authorizeTransition"]> = transition => Result.gen(function* () {
      const live = inspect(access, input.attempt);
      if (live === undefined || transition.tableName !== selected.state.tableName) return yield* Result.fail(refused("invalidAuthority"));
      const operation = transition.operation === "insert" ? "create" : transition.operation === "delete" ? "delete" : "update";
      if (input.method !== `payload-${operation}`) return yield* Result.fail(refused("invalidAuthority"));
      if (!live.fact.permissions.source[operation]) return yield* Result.fail(refused("denied"));
      const after = yield* target(transition.after);
      if (after === null) return;
      const original = yield* target(transition.original), before = yield* target(transition.before);
      let retained = operation !== "create" && original === after && before === after;
      for (const previous of transition.previous) {
        if ((yield* target(previous.before)) !== original || (yield* target(previous.after)) !== original) retained = false;
      }
      if (!(retained ? live.fact.permissions.retain : live.fact.permissions.assign).includes(after)) return yield* Result.fail(refused("denied"));
    });
    return authorize;
  });
}
