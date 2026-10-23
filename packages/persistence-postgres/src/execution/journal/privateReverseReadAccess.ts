import { Data, Effect, Option, Result, Schema } from "effect";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { inspectLogicalParticipantAdmissionBundle, inspectLogicalParticipantAttemptAdmission,
  issueLogicalParticipantAdmissionBundle } from "../../storage/documents/logicalDocuments/participantAdmission";
import { withLogicalDocumentAttemptAdmissionEffect } from "../../storage/documents/logicalDocuments/documentAdmission";
import { requireFiniteAttemptPreparationOpen, requireFiniteProductReference } from "../../storage/documents/logicalDocuments/sourceAdmission";
import { selectLogicalIndex } from "../../storage/documents/logicalDocuments/query";
import { reserveLogicalDocumentRootBytes } from "../../storage/documents/logicalDocuments/rootEvaluator";
import { cmsError } from "../../frameworks/cmsTransaction/model";
import { inspectPrivateReverseReadEvidence, type PrivateReverseReadEvidence } from "./privateReverseReadEvidence";
import { PrivateReadPrincipal } from "./privateReadAccess";
import type { LogicalParticipantBorrowBase, SessionJournalAttempt, SessionJournalStorePersistence } from "./contracts";
import type { JournalAttemptOwner } from "./attemptOwner";
import { discardFiniteRootEvidence } from "./finiteRoot";

/** RR1 feasibility only: no documents, counts or cursors leave the probe. */
export const PRIVATE_REFERENCE_MEMBERSHIP_PROBE = "private-reference-membership-probe";
const Selection = Schema.Struct({ participant: Schema.NonEmptyString, collection: Schema.NonEmptyString,
  relation: Schema.NonEmptyString, productId: Schema.NonEmptyString,
  nativeProfileRevision: PrivateReadPrincipal.fields.principalDigest });
export type PrivateReverseReadSelection = typeof Selection.Type;
const decodeSelection = Schema.decodeUnknownEffect(Selection, { onExcessProperty: "error" });
export class PrivateReverseReadAccessError extends Data.TaggedError("PrivateReverseReadAccessError")<{
  readonly reason: "invalidAuthority" | "denied" | "resourceFailure" | "limitExceeded"; readonly cause?: unknown;
}> {}
const refused = (reason: PrivateReverseReadAccessError["reason"], cause?: unknown) =>
  new PrivateReverseReadAccessError({ reason, ...(cause === undefined ? {} : { cause }) });
declare const accessBrand: unique symbol;
export interface PrivateReverseReadAccess { readonly [accessBrand]: true }
type IssuedSelection = PrivateReverseReadSelection & Readonly<{
  tableName: string; tableId: import("flarex-protocol/catalog").CatalogTableId;
  indexDefinitionId: import("flarex-protocol/catalog").CatalogIndexDefinitionId;
  profileRevision: string; admission: LogicalParticipantBorrowBase["bundle"];
}>;
const accesses = new WeakMap<object, Readonly<{ attempt: SessionJournalAttempt; evidence: PrivateReverseReadEvidence;
  principal: PrivateReadPrincipal; selection: IssuedSelection; isLive: () => boolean }>>();
export function inspectPrivateReverseReadAccess(access: PrivateReverseReadAccess, attempt: SessionJournalAttempt) {
  const state = accesses.get(access);
  return state?.attempt === attempt && state.isLive() &&
    inspectPrivateReverseReadEvidence(state.evidence, attempt, state.principal) !== undefined ? state.selection : undefined;
}

export function makePrivateReverseReadOperations(owner: JournalAttemptOwner) {
  const preparePrivateReverseReferenceReadEffect: SessionJournalStorePersistence["preparePrivateReverseReferenceReadEffect"] =
    Effect.fn("PrivateReverseRead.prepare")(function* (attempt, evidence, input) {
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
          yield* Effect.fromResult(requireFiniteAttemptPreparationOpen(finite.metadata, attempt))
            .pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
          if (Option.isNone(evidence)) return yield* Effect.fail(refused("denied"));
          const principal = { scopeId: attempted.selector.scopeId, principalDigest: finite.initialContext.principalDigest };
          const fact = inspectPrivateReverseReadEvidence(evidence.value, attempt, principal);
          if (fact === undefined || fact.permissions.collection !== selection.collection || fact.permissions.relation !== selection.relation)
            return yield* Effect.fail(refused("invalidAuthority"));
          if (!fact.permissions.enumerate.includes(selection.productId)) return yield* Effect.fail(refused("denied"));
          const entry = finite.admissions.get(selection.participant);
          const method = PRIVATE_REFERENCE_MEMBERSHIP_PROBE;
          const parent = entry?.selection.profileRevision !== selection.nativeProfileRevision ? null :
            inspectLogicalParticipantAdmissionBundle(entry.bundle, attempt, selection.participant, method, selection.nativeProfileRevision);
          const admission = parent?.admissions[0];
          const source = admission === undefined ? null : inspectLogicalParticipantAttemptAdmission(admission, attempt, method);
          if (parent === null || parent.admissions.length !== 1 || admission === undefined || source?.metadata !== finite.metadata)
            return yield* Effect.fail(refused("invalidAuthority"));
          const selected = yield* withLogicalDocumentAttemptAdmissionEffect(admission, attempt, method, state => Effect.gen(function* () {
            const configuration = state.configuration.tables.find(table => table.collectionSlug === selection.collection);
            const table = state.tables.find(member => member.localName === configuration?.logicalTableName);
            if (table === undefined || configuration === undefined || !configuration.fields.some(field =>
              field.name === selection.relation && field.kind === "text" && field.nullable === true) ||
              fact.permissions.articles.some(id => decodeAppDocumentIdentityV1(id).tableId !== table.tableId))
              return yield* Effect.fail(refused("invalidAuthority"));
            yield* Effect.fromResult(requireFiniteProductReference(finite.metadata, attempt, source.sourceKey,
              table.localName, selection.relation)).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
            const index = yield* Effect.fromResult(selectLogicalIndex(state.indexes,
              table.tableId, { [selection.relation]: selection.productId }, cmsError));
            if (Option.isNone(index)) return yield* Effect.fail(refused("invalidAuthority"));
            return { tableName: table.localName, tableId: table.tableId, indexDefinitionId: index.value.definition.indexDefinitionId,
              contentIdentity: state.contentIdentity };
          }), (_state, _read, prepared) => Effect.succeed(prepared)).pipe(Effect.mapError(cause =>
            cause instanceof PrivateReverseReadAccessError ? cause : refused(cause.reason === "resourceFailure" ? "resourceFailure" : "invalidAuthority", cause)));
          const identity = yield* capturePrivateCanonicalValue({ format: "flarex.private-reverse-read-access", version: 1,
            ...selection, ...selected.contentIdentity, sourceKey: source.sourceKey, sourceSha256: source.sourceSha256,
            tableId: selected.tableId, indexDefinitionId: selected.indexDefinitionId,
            policyDocumentId: fact.documentId, policySha256: fact.policySha256, permissions: fact.permissions }, 1_048_576,
            { invalidInput: () => refused("invalidAuthority"), hashFailure: cause => refused("resourceFailure", cause) });
          if (finite.status !== "open" || finite.inFlightOperations !== 1 || finite.commandWriter !== undefined || owner.isAdmittedOperationInFlight(key) ||
            inspectPrivateReverseReadEvidence(evidence.value, attempt, principal) === undefined)
            return yield* Effect.fail(refused("invalidAuthority"));
          yield* Effect.fromResult(reserveLogicalDocumentRootBytes(finite.evaluator, { attempt, scopeId: principal.scopeId,
            snapshotCommitSeq: attempted.snapshotToken.commitSeq, attemptFence: attempted.selector.attemptFence.toString() }, identity.canonicalByteLength))
            .pipe(Effect.mapError(reason => refused(reason === "limitExceeded" ? "limitExceeded" : "invalidAuthority")));
          const bundle = yield* Effect.fromResult(issueLogicalParticipantAdmissionBundle(attempt, { participant: selection.participant,
            operationMethods: [method], profileRevision: identity.sha256Hex, sources: [{ admission, methods: [method] }] }))
            .pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
          // SAFETY: this finite owner registers authority only after protected evidence and source checks.
          const access = Object.freeze({}) as PrivateReverseReadAccess;
          accesses.set(access, { attempt, evidence: evidence.value, principal,
            selection: Object.freeze({ ...selection, tableName: selected.tableName, tableId: selected.tableId,
              indexDefinitionId: selected.indexDefinitionId, profileRevision: identity.sha256Hex, admission: bundle }),
            isLive: () => finite.status === "open" && Result.isSuccess(requireFiniteAttemptPreparationOpen(finite.metadata, attempt)) });
          return access;
        }).pipe(Effect.ensuring(Effect.sync(() => { finite.inFlightOperations--; })));
      }).pipe(Effect.onError(() => Effect.sync(() => { finite.status = "aborted"; discardFiniteRootEvidence(finite); })));
    });
  return { preparePrivateReverseReferenceReadEffect };
}
