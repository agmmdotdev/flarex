import { createHash } from "node:crypto";
import { Effect, Option, Schema } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { AppDocumentIdV1Schema, type AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { PrivateReverseReadPermissions, inspectPrivateReverseReadEvidence } from "../../../persistence-postgres/src/execution/journal/privateReverseReadEvidence";
import { PRIVATE_REFERENCE_MEMBERSHIP_PROBE, inspectPrivateReverseReadAccess } from "../../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { makePrivateReferenceProbeBorrow } from "../../../persistence-postgres/src/frameworks/cmsTransaction/privateReferenceProbe";
import type { CmsReferenceProbeTestHooks } from "../../../persistence-postgres/src/frameworks/cmsTransaction/testSupport";
import { readFrozenFiniteAttempt } from "../../../persistence-postgres/src/execution/journal/frozenAttempt";
import { preparePrivateSavePolicy, bindPrivatePayloadSave } from "./privatePayloadSaveCommands";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture, PrivatePayloadSaveRoot } from "./privatePayloadSaveFixture";

const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
const productResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const articleResult = Schema.decodeUnknownSync(Schema.Struct({ id: AppDocumentIdV1Schema }));
const storedArticle = Schema.decodeUnknownSync(Schema.Struct({ _id: AppDocumentIdV1Schema }));
type Policy = typeof PrivateReverseReadPermissions.Type;

/** Arrangement and observations only; genuine owners protect, issue, capture and publish. */
export async function privatePayloadReverseReadScenario(fixture: PrivatePayloadSaveFixture) {
  const { store } = fixture.fixture;
  const counts = () => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const product = async (handle: string) => productResult(await Effect.runPromise(fixture.productHost.run(
    fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductCreate, { title: handle, handle })));
  const first = await product("private-reverse-first");
  const second = await product("private-reverse-second");
  const savingPolicy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true },
    assign: [first.id, second.id], retain: [first.id, second.id] });
  expect(await savingPolicy.root.publish()).toMatchObject({ kind: "published" });

  const writePolicy = async (change: Partial<Pick<Policy, "enumerate" | "articles" | "relation" | "principal">> = {}, documentId?: AppDocumentIdV1) => {
    const root = await fixture.fixture.open();
    const writer = await Effect.runPromise(store.preparePrivateApplicationCommandEffect(root.attempt, "audit"));
    const policy: Policy = { format: "flarex.private-reference-read-permissions", version: 1, principal: root.principal,
      collection: "posts", relation: "featuredProduct", enumerate: [first.id, second.id], articles: [], ...change };
    const fields = { policy };
    const result = await Effect.runPromise(writer.run(documentId === undefined ? { kind: "insert", fields, syscallSequence: sequence(1n) } :
      { kind: "replace", documentId, fields, syscallSequence: sequence(1n) }, root.validator));
    if (result.kind !== "completed") throw new Error("Protected read policy command refused");
    const id = result.outcome.kind === "inserted" ? result.outcome.documentId : documentId;
    if (id === undefined) throw new Error("Missing protected policy identity");
    return { root, id, policy };
  };
  const initial = await writePolicy();
  expect(await initial.root.publish()).toMatchObject({ kind: "published" });
  const selection = (productId = first.id) => ({ participant: "payload", collection: "posts", relation: "featuredProduct",
    productId, nativeProfileRevision: "1".repeat(64) });
  const read = (root: PrivatePayloadSaveRoot, documentId = initial.id, ordinal = 1n, tableName = "audit") =>
    store.readPrivateReverseReferencePermissionsEffect(root.attempt,
      { tableName, documentId, syscallSequence: sequence(ordinal), principal: root.principal }, root.validator);
  const openProbe = async (productId = first.id, existing?: PrivatePayloadSaveRoot, policySequence = 1n) => {
    const root = existing ?? await fixture.open();
    const evidence = await Effect.runPromise(read(root, initial.id, policySequence));
    const access = await Effect.runPromise(store.preparePrivateReverseReferenceReadEffect(root.attempt, evidence, selection(productId)));
    const selected = inspectPrivateReverseReadAccess(access, root.attempt);
    if (selected === undefined) throw new Error("Missing genuine reverse-read selection");
    const frame = await Effect.runPromise(Effect.fromResult(encodeAdmittedFrameworkOperationV1Result({ format: "flarex.admitted-framework-operation",
      version: 1, participant: "payload", operation: PRIVATE_REFERENCE_MEMBERSHIP_PROBE, args: null })));
    const memberships: Parameters<NonNullable<CmsReferenceProbeTestHooks["afterMembership"]>>[0][] = [];
    const invoke = (ordinal = policySequence + 1n) => store.runAdmittedOperationEffect(root.attempt, selected.admission,
      { syscallSequence: sequence(ordinal), requestBytes: frame.bytes, requestSha256: createHash("sha256").update(frame.bytes).digest(),
        participant: "payload", method: PRIVATE_REFERENCE_MEMBERSHIP_PROBE, profileRevision: selected.profileRevision },
      makePrivateReferenceProbeBorrow(access, { afterMembership: result => { memberships.push(result); } }));
    const prepare = () => root.preparePublication(null, { logicalOperationProfiles: [root.payloadProfile(selected.profileRevision)] });
    return { root, access, selected, invoke, prepare, evidence, memberships };
  };
  const frozen = (publication: Awaited<ReturnType<Awaited<ReturnType<typeof openProbe>>["prepare"]>>) => {
    const data = readFrozenFiniteAttempt(publication.command.frozenAttempt);
    if (data === undefined) throw new Error("Missing genuine frozen evidence");
    return data;
  };
  const createArticle = async (productId: string) => {
    const root = await fixture.open();
    const saving = await bindPrivatePayloadSave(fixture, root, savingPolicy.documentId);
    try {
      const result = await Effect.runPromise(saving.invoke("create", { collection: "posts", data: { title: "Indexed article", featuredProduct: productId } }));
      if (result.kind !== "completed") throw new Error("Native Payload create refused");
      const article = articleResult(result.result);
      expect(await root.publish(null, [root.payloadProfile(saving.selected.profileRevision)])).toMatchObject({ kind: "published" });
      return article;
    } finally { await saving.close(); }
  };

  // Empty membership is an indexed negative observation, never an untracked empty list.
  const empty = await openProbe();
  expect(await Effect.runPromise(empty.invoke())).toMatchObject({ kind: "completed", delivery: "executed", result: null });
  expect(await Effect.runPromise(empty.invoke())).toMatchObject({ kind: "completed", delivery: "replayed", result: null });
  expect(empty.memberships).toEqual([{ docs: [], total: 0 }]);
  const emptyPublication = await empty.prepare();
  expect(frozen(emptyPublication).graph.scans).toEqual([]);
  expect(frozen(emptyPublication).graph.indexReads).toMatchObject([{ definition: { indexDefinitionId: empty.selected.indexDefinitionId }, entries: [] }]);
  const article = await createArticle(first.id);
  const beforeConflict = await counts();
  await expect(Effect.runPromise(emptyPublication.publish)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
  expect(await counts()).toEqual(beforeConflict);

  // Nonempty capture reaches the same final owner and exposes no source data.
  const nonempty = await openProbe();
  expect(await Effect.runPromise(nonempty.invoke())).toMatchObject({ kind: "completed", result: null });
  expect(nonempty.memberships).toHaveLength(1);
  expect(nonempty.memberships[0]?.total).toBe(1);
  expect(storedArticle(nonempty.memberships[0]?.docs[0])._id).toBe(article.id);
  const nonemptyPublication = await nonempty.prepare();
  const data = frozen(nonemptyPublication);
  expect(data.graph.scans).toEqual([]);
  expect(data.graph.indexReads).toMatchObject([{ definition: { indexDefinitionId: nonempty.selected.indexDefinitionId }, entries: [expect.anything()] }]);
  expect(data.graph.observedRows.some(row => row.documentId === article.id)).toBe(true);
  expect(await Effect.runPromise(nonemptyPublication.publish)).toMatchObject({ kind: "published" });
  expect(inspectPrivateReverseReadAccess(nonempty.access, nonempty.root.attempt)).toBeUndefined();

  // A genuine policy update invalidates prior tracked evidence at publication.
  const stale = await openProbe();
  await Effect.runPromise(stale.invoke());
  const stalePublication = await stale.prepare();
  const revoke = await writePolicy({ enumerate: [] }, initial.id);
  expect(await revoke.root.publish()).toMatchObject({ kind: "published" });
  const beforeRevoked = await counts();
  await expect(Effect.runPromise(stalePublication.publish)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
  expect(await counts()).toEqual(beforeRevoked);
  const denied = await fixture.open();
  const deniedEvidence = await Effect.runPromise(read(denied));
  await expect(Effect.runPromise(store.preparePrivateReverseReferenceReadEffect(denied.attempt, deniedEvidence, selection())))
    .rejects.toMatchObject({ reason: "denied" });
  await expect(denied.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });

  const restore = await writePolicy({}, initial.id);
  expect(await restore.root.publish()).toMatchObject({ kind: "published" });

  // Native pending membership and its indexed negative base share one evaluator.
  const pendingRoot = await fixture.open();
  const pendingSave = await bindPrivatePayloadSave(fixture, pendingRoot, savingPolicy.documentId);
  try {
    const result = await Effect.runPromise(pendingSave.invoke("create", { collection: "posts",
      data: { title: "Pending reverse member", featuredProduct: second.id } }));
    if (result.kind !== "completed") throw new Error("Pending native create refused");
    const pendingArticle = articleResult(result.result);
    const pendingProbe = await openProbe(second.id, pendingRoot, 3n);
    expect(await Effect.runPromise(pendingProbe.invoke())).toMatchObject({ kind: "completed", result: null });
    expect(pendingProbe.memberships).toHaveLength(1);
    expect(pendingProbe.memberships[0]?.total).toBe(1);
    expect(storedArticle(pendingProbe.memberships[0]?.docs[0])._id).toBe(pendingArticle.id);
    const publication = await pendingRoot.preparePublication(null, { logicalOperationProfiles: [
      pendingRoot.payloadProfile(pendingSave.selected.profileRevision), pendingRoot.payloadProfile(pendingProbe.selected.profileRevision)] });
    const pendingData = frozen(publication);
    expect(pendingData.graph.scans).toEqual([]);
    expect(pendingData.graph.indexReads).toMatchObject([{ entries: [] }]);
    expect(pendingData.graph.observedRows.some(row => row.documentId === pendingArticle.id)).toBe(true);
    expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
  } finally { await pendingSave.close(); }

  const authentic = await fixture.open();
  const evidence = await Effect.runPromise(read(authentic));
  expect(Option.isSome(evidence)).toBe(true);
  if (Option.isNone(evidence)) throw new Error("Missing actual read evidence");
  expect(inspectPrivateReverseReadEvidence(evidence.value, authentic.attempt, authentic.principal)?.documentId).toBe(initial.id);
  const foreignAttempt = await fixture.open();
  await expect(Effect.runPromise(store.preparePrivateReverseReferenceReadEffect(foreignAttempt.attempt, evidence, selection())))
    .rejects.toMatchObject({ reason: "invalidAuthority" });
  expect(inspectPrivateReverseReadEvidence(evidence.value, authentic.attempt,
    { ...authentic.principal, principalDigest: "f".repeat(64) })).toBeUndefined();

  // Command-only ownership survives; an ordinary mutation cannot replace either record contract.
  const ordinary = await fixture.open();
  const audit = await Effect.runPromise(store.resolvePointTableEffect(ordinary.attempt, "audit"));
  await expect(Effect.runPromise(store.runPointOperationEffect(audit, { kind: "replace", documentId: initial.id,
    fields: { policy: initial.policy }, syscallSequence: sequence(1n) }, ordinary.validator)))
    .rejects.toMatchObject({ _tag: "ApplicationTableWriteDeniedError" });
  const wrongContract = await fixture.open();
  await expect(Effect.runPromise(read(wrongContract, savingPolicy.documentId))).rejects.toMatchObject({ reason: "storedCorruption" });
  const wrongTable = await fixture.open();
  await expect(Effect.runPromise(read(wrongTable, initial.id, 1n, "users"))).rejects.toMatchObject({ reason: "invalidAuthority" });
  const wrongArticle = await writePolicy({ articles: [initial.id] });
  expect(await wrongArticle.root.publish()).toMatchObject({ kind: "published" });
  const mismatched = await fixture.open();
  const mismatchedEvidence = await Effect.runPromise(read(mismatched, wrongArticle.id));
  await expect(Effect.runPromise(store.preparePrivateReverseReferenceReadEffect(mismatched.attempt, mismatchedEvidence, selection())))
    .rejects.toMatchObject({ reason: "invalidAuthority" });
  const otherPrincipal = await writePolicy({ principal: { ...initial.policy.principal, principalDigest: "f".repeat(64) } });
  expect(await otherPrincipal.root.publish()).toMatchObject({ kind: "published" });
  const principalMismatch = await fixture.open();
  await expect(Effect.runPromise(read(principalMismatch, otherPrincipal.id))).rejects.toMatchObject({ reason: "invalidAuthority" });
  const wrongRelation = await writePolicy({ relation: "title" });
  expect(await wrongRelation.root.publish()).toMatchObject({ kind: "published" });
  const relationMismatch = await fixture.open();
  const relationEvidence = await Effect.runPromise(read(relationMismatch, wrongRelation.id));
  await expect(Effect.runPromise(store.preparePrivateReverseReferenceReadEffect(relationMismatch.attempt,
    relationEvidence, { ...selection(), relation: "title" }))).rejects.toMatchObject({ reason: "invalidAuthority" });

  // A missing protected point is tracked too; subsequent creation conflicts.
  const unpublished = await writePolicy();
  const missing = await fixture.open();
  expect(await Effect.runPromise(read(missing, unpublished.id))).toEqual(Option.none());
  const absent = await fixture.open();
  const absentEvidence = await Effect.runPromise(read(absent, unpublished.id));
  await expect(Effect.runPromise(store.preparePrivateReverseReferenceReadEffect(absent.attempt, absentEvidence, selection())))
    .rejects.toMatchObject({ reason: "denied" });
  const missingPublication = await missing.preparePublication();
  expect(await unpublished.root.publish()).toMatchObject({ kind: "published" });
  const beforeMissing = await counts();
  await expect(Effect.runPromise(missingPublication.publish)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
  expect(await counts()).toEqual(beforeMissing);
}
