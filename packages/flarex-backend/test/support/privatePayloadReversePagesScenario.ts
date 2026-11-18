import { Cause, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema, MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 } from "flarex-protocol/commit-protocol";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { AppDocumentIdV1Schema, decodeAppDocumentIdentityV1, type AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { inspectPrivateReverseReadAccess, PRIVATE_REFERENCE_PAGE } from "../../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import type { PayloadReferencePagesInstrumentation } from "../../../payload-adapter/src/runtime/referencePages";
import { readFrozenFiniteAttempt } from "../../../persistence-postgres/src/execution/journal/frozenAttempt";
import { openPrivateReverseRead, preparePrivateReverseReadPolicy } from "./privatePayloadReverseReadCommands";
import { bindPrivatePayloadSave, preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture, PrivatePayloadSaveRoot } from "./privatePayloadSaveFixture";

const seq = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
const article = Schema.decodeUnknownSync(Schema.Struct({ id: AppDocumentIdV1Schema }));
const product = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const page = Schema.decodeUnknownSync(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: AppDocumentIdV1Schema, title: Schema.String })),
  hasMore: Schema.Boolean, cursor: Schema.NullOr(Schema.String) }));

/** Setup invokes real owners. No permission evaluator, query merge or retry lives here. */
export async function privatePayloadReversePagesScenario(fixture: PrivatePayloadSaveFixture) {
  const { store } = fixture.fixture;
  const counts = () => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const first = product(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "RR2 first", handle: "rr2-first" })));
  const second = product(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "RR2 second", handle: "rr2-second" })));
  const savingPolicy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true },
    assign: [first.id, second.id], retain: [first.id, second.id] });
  await savingPolicy.root.publish();
  const seeded = await fixture.open();
  const saving = await bindPrivatePayloadSave(fixture, seeded, savingPolicy.documentId);
  const ids: AppDocumentIdV1[] = [];
  try {
    for (let i = 0; i < 9; i++) {
      const result = await Effect.runPromise(saving.invoke("create", { collection: "posts", data: { title: `RR2 article ${i}`, featuredProduct: first.id } }));
      if (result.kind !== "completed") throw new Error("Native seed refused");
      ids.push(article(result.result).id);
    }
    expect(await seeded.publish(null, [seeded.payloadProfile(saving.selected.profileRevision)])).toMatchObject({ kind: "published" });
  } finally { await saving.close(); }
  // The installed developer index appends creation time before its row-ID tie
  // break. These genuine successive insertions have increasing creation times.
  const visible = [ids[1]!, ids[3]!, ids[6]!];
  let policyPrincipal: PrivatePayloadSaveRoot["principal"];
  const writePolicy = async (articles: readonly AppDocumentIdV1[], existing?: AppDocumentIdV1) => {
    const prepared = await preparePrivateReverseReadPolicy(fixture, { enumerate: [first.id, second.id], articles }, existing);
    policyPrincipal = prepared.root.principal;
    expect(await prepared.root.publish()).toMatchObject({ kind: "published" });
    return prepared.documentId;
  };
  const policyId = await writePolicy(visible);
  const open = (options: { productId?: string; targetIds?: readonly string[]; instrumentation?: PayloadReferencePagesInstrumentation;
    principal?: PrivatePayloadSaveRoot["principal"] } = {}) => openPrivateReverseRead(fixture, policyId,
      options.principal ?? policyPrincipal, options.productId ?? first.id, options);

  // Hidden candidates surround visible rows. Native hooks execute for the
  // returned document and the visible successor, never for hidden identities.
  const hookIds: string[] = [];
  const reading = await open({ instrumentation: { hooks: { afterRead: [({ doc }) => { hookIds.push(String(doc.id)); return { ...doc, title: `${doc.title} read` }; }] } } });
  expect(await Effect.runPromise(reading.retrieve())).toMatchObject({ kind: "completed" });
  const bound = await reading.bind();
  try {
    const a = await bound.read(1);
    expect(a.docs.map(doc => doc.id)).toEqual(visible.slice(0, 1)); expect(a.hasMore).toBe(true);
    expect(a.cursor).toMatch(/^[a-f0-9-]{36}$/); expect(a.docs[0]?.title).toMatch(/ read$/);
    expect(hookIds).toEqual(visible.slice(0, 2));
    if (a.cursor === null) throw new Error("Missing visible continuation");
    const b = await bound.read(1, a.cursor);
    expect(b.docs.map(doc => doc.id)).toEqual(visible.slice(1, 2));
    if (b.cursor === null) throw new Error("Missing second continuation");
    const c = await bound.read(1, b.cursor);
    expect(c).toMatchObject({ hasMore: false, cursor: null }); expect(c.docs.map(doc => doc.id)).toEqual(visible.slice(2));
    const replay = await Effect.runPromise(bound.invoke({ limit: 1 }, 3n));
    expect(replay).toMatchObject({ kind: "completed", delivery: "replayed" }); expect(hookIds).toHaveLength(5);
    const publication = await bound.prepare();
    const frozen = readFrozenFiniteAttempt(publication.command.frozenAttempt);
    expect(frozen?.graph.scans).toEqual([]);
    expect(frozen?.graph.pageReads.length).toBeGreaterThan(0);
    const windows = frozen?.graph.pageReads;
    expect(windows).toHaveLength(3);
    expect(windows?.map(window => [window.entries.length, window.isDone])).toEqual([[9, true], [7, true], [5, true]]);
    expect(windows?.[0]?.after).toBeUndefined();
    expect(windows?.[0]?.bounds.startInclusive).toBeDefined(); expect(windows?.[0]?.bounds.endExclusive).toBeDefined();
    for (let i = 1; i < 3; i++) {
      const predecessor = visible[i - 1]; if (predecessor === undefined) throw new Error("Missing visible predecessor");
      const entry = windows?.[0]?.entries.find(entry => entry.rowId === decodeAppDocumentIdentityV1(predecessor).rowId);
      expect(windows?.[i]?.after).toEqual({ encodedKey: entry?.encodedKey, rowId: entry?.rowId });
      expect(windows?.[i]?.bounds).toEqual(windows?.[0]?.bounds);
    }
    expect(frozen?.graph.indexReads.filter(read => read.definition.indexDefinitionId === bound.selection.indexDefinitionId)).toEqual([]);
    expect(frozen?.graph.pageReads.every(read => read.definition.indexDefinitionId === bound.selection.indexDefinitionId)).toBe(true);
    expect(frozen?.graph.dependencies.filter(dep => ids.includes(dep.documentId)).map(dep => dep.documentId).sort()).toEqual([...visible].sort());
    expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
    expect(inspectPrivateReverseReadAccess(bound.access, reading.root.attempt)).toBeUndefined();
  } finally { await bound.close(); }

  for (const kind of ["allHidden", "empty"] as const) {
    if (kind === "allHidden") await writePolicy([], policyId);
    const reading = await open({ productId: kind === "empty" ? second.id : first.id });
    await Effect.runPromise(reading.retrieve()); const bound = await reading.bind();
    try { expect(await bound.read(2)).toEqual({ docs: [], hasMore: false, cursor: null });
      const publication = await bound.prepare();
      expect(readFrozenFiniteAttempt(publication.command.frozenAttempt)?.graph.pageReads).toMatchObject([
        { entries: kind === "empty" ? [] : expect.any(Array), isDone: true }]);
      expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
    } finally { await bound.close(); }
  }
  await writePolicy(visible, policyId);

  // No receipt, a denied target and a forged/rebound continuation poison the root.
  const noTarget = await open();
  await expect(Effect.runPromise(noTarget.derive())).rejects.toMatchObject({ reason: "denied" });
  await expect(noTarget.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  for (const options of [{ targetIds: [] }, { productId: "missing-product" },
    { principal: { ...policyPrincipal!, principalDigest: "f".repeat(64) } },
    { principal: { ...policyPrincipal!, scopeId: ScopeIdSchema.make("scope_rr2_other_shop") } }]) {
    const unavailable = await open(options);
    const before = await counts();
    await expect(Effect.runPromise(unavailable.retrieve())).rejects.toBeDefined();
    await expect(unavailable.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
    expect(await counts()).toEqual(before);
  }

  const reissued = await open(); await Effect.runPromise(reissued.retrieve());
  const originalBinding = await reissued.bind(); const issuedPage = await originalBinding.read(1);
  const otherBinding = await reissued.bind();
  try {
    if (issuedPage.cursor === null) throw new Error("Missing same-root cursor");
    expect(otherBinding.selection.profileRevision).toBe(originalBinding.selection.profileRevision);
    await expect(Effect.runPromise(otherBinding.invoke({ limit: 1, cursor: issuedPage.cursor }, 4n))).rejects.toBeDefined();
    await expect(reissued.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  } finally { await otherBinding.close(); await originalBinding.close(); }
  for (const kind of ["forged", "foreignAttempt", "foreignSelection"] as const) {
    const original = await open(); await Effect.runPromise(original.retrieve()); const a = await original.bind();
    let other: Awaited<ReturnType<typeof open>> | undefined; let b: typeof a | undefined;
    try {
      const firstPage = await a.read(1); if (firstPage.cursor === null) throw new Error("Missing cursor");
      if (kind !== "forged") {
        other = await open({ productId: kind === "foreignSelection" ? second.id : first.id });
        await Effect.runPromise(other.retrieve()); b = await other.bind();
      }
      const target = b ?? a;
      const before = await counts();
      await expect(Effect.runPromise(target.invoke({ limit: 1, cursor: kind === "forged" ? "forged" : firstPage.cursor }))).rejects.toBeDefined();
      await expect((other?.root ?? original.root).publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
      expect(await counts()).toEqual(before);
    } finally { await b?.close(); await a.close(); }
  }

  // Real native changes merge into the same root, and invalidate only relevant
  // source continuations. The result cannot silently truncate after a failure.
  const pending = await open(); await Effect.runPromise(pending.retrieve());
  const pendingSave = await bindPrivatePayloadSave(fixture, pending.root, savingPolicy.documentId, { policySequence: 3n });
  try {
    const moved = visible[0]!, cleared = visible[1]!, deleted = visible[2]!;
    await Effect.runPromise(pendingSave.invoke("update", { collection: "posts", id: moved, data: { featuredProduct: second.id } }, 4n));
    await Effect.runPromise(pendingSave.invoke("update", { collection: "posts", id: cleared, data: { featuredProduct: null } }, 5n));
    await Effect.runPromise(pendingSave.invoke("delete", { collection: "posts", id: deleted }, 6n));
    const bound = await pending.bind();
    try {
      const result = await Effect.runPromise(bound.invoke({ limit: 2 }, 7n));
      expect(result).toMatchObject({ kind: "completed", result: { docs: [], hasMore: false, cursor: null } });
      const publication = await pending.root.preparePublication(null, { logicalOperationProfiles: [...pending.profiles.filter(p => p.participant !== "payload"),
        pending.root.payloadProfile(pendingSave.selected.profileRevision), pending.root.payloadProfile(bound.selection.profileRevision)] });
      expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
    } finally { await bound.close(); }
  } finally { await pendingSave.close(); }

  await writePolicy(ids, policyId);
  const stable = await open(); await Effect.runPromise(stable.retrieve()); const stablePage = await stable.bind();
  const firstStable = await stablePage.read(1); if (firstStable.cursor === null) throw new Error("Missing pending-state cursor");
  const edit = await bindPrivatePayloadSave(fixture, stable.root, savingPolicy.documentId, { policySequence: 4n });
  try {
    // The cleared article is outside this selected Product's membership.
    await Effect.runPromise(edit.invoke("update", { collection: "posts", id: visible[1]!, data: { title: "Unrelated member" } }, 5n));
    const b = await Effect.runPromise(stablePage.invoke({ limit: 1, cursor: firstStable.cursor }, 6n));
    expect(b).toMatchObject({ kind: "completed" });
    await Effect.runPromise(edit.invoke("update", { collection: "posts", id: ids[0]!, data: { title: "Relevant member changed" } }, 7n));
    const before = await counts();
    await expect(Effect.runPromise(stablePage.invoke({ limit: 1, cursor: firstStable.cursor }, 8n))).rejects.toBeDefined();
    await expect(stable.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" }); expect(await counts()).toEqual(before);
  } finally { await edit.close(); await stablePage.close(); }

  await writePolicy([], policyId);
  const observations: { readonly pendingIds: readonly AppDocumentIdV1[]; readonly inspected: number }[] = [];
  const creation = await open({ productId: second.id, instrumentation: { hooks: {}, documentReads: { afterReferencePage: observation => { observations.push(observation); } } } });
  await Effect.runPromise(creation.retrieve());
  const create = await bindPrivatePayloadSave(fixture, creation.root, savingPolicy.documentId, { policySequence: 3n });
  try {
    const result = await Effect.runPromise(create.invoke("create", { collection: "posts", data: { title: "Pending hidden member", featuredProduct: second.id } }, 4n));
    if (result.kind !== "completed") throw new Error("Pending native create refused");
    const created = article(result.result);
    const bound = await creation.bind();
    try {
      expect(await Effect.runPromise(bound.invoke({ limit: 1 }, 5n))).toMatchObject({ kind: "completed", result: { docs: [], hasMore: false, cursor: null } });
      expect(observations).toEqual([{ pendingIds: [created.id], inspected: 2, hasMore: false }]);
      const publication = await creation.root.preparePublication(null, { logicalOperationProfiles: [...creation.profiles.filter(p => p.participant !== "payload"),
        creation.root.payloadProfile(create.selected.profileRevision), creation.root.payloadProfile(bound.selection.profileRevision)] });
      expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
    } finally { await bound.close(); }
  } finally { await create.close(); }

  // An admitted native hook failure must abort the entire read, including a
  // successful first hydration. It cannot become a filtered/partial page.
  await writePolicy(ids, policyId);
  let nativeReads = 0;
  const failing = await open({ instrumentation: { hooks: { afterRead: [({ doc }) => {
    if (++nativeReads === 2) throw new Error("RR2 native lookahead failure"); return doc;
  }] } } });
  await Effect.runPromise(failing.retrieve()); const failurePage = await failing.bind();
  try {
    const before = await counts();
    await expect(Effect.runPromise(failurePage.invoke({ limit: 1 }))).rejects.toBeDefined(); expect(nativeReads).toBe(2);
    await expect(failing.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" }); expect(await counts()).toEqual(before);
  } finally { await failurePage.close(); }

  await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductSoftDelete, second.id));
  const softDeleted = await open({ productId: second.id });
  await expect(Effect.runPromise(softDeleted.retrieve())).rejects.toBeDefined();
  await expect(softDeleted.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductRestore, second.id));
  const restored = await open({ productId: second.id }); await Effect.runPromise(restored.retrieve()); const restoredPage = await restored.bind();
  try { expect((await restoredPage.read(2)).docs.map(doc => doc.id)).toEqual([visible[0]]);
    expect(await Effect.runPromise((await restoredPage.prepare()).publish)).toMatchObject({ kind: "published" });
  } finally { await restoredPage.close(); }

  // Fan-out exceeds the existing per-call inspected-membership budget while
  // the output policy allows no articles. A result limit of one grants no scan.
  for (let batch = 0; batch < 9; batch++) {
    const root = await fixture.open(); const save = await bindPrivatePayloadSave(fixture, root, savingPolicy.documentId);
    try {
      for (let i = 0; i < 30; i++) await Effect.runPromise(save.invoke("create", { collection: "posts",
        data: { title: `Hidden fanout ${batch}/${i}`, featuredProduct: first.id } }));
      expect(await root.publish(null, [root.payloadProfile(save.selected.profileRevision)])).toMatchObject({ kind: "published" });
    } finally { await save.close(); }
  }
  await writePolicy([ids[0]!, ids[2]!], policyId);
  const prefix = await open(); await Effect.runPromise(prefix.retrieve()); const prefixPage = await prefix.bind();
  try {
    expect(await prefixPage.read(1)).toMatchObject({ docs: [{ id: ids[0] }], hasMore: true });
    const publication = await prefixPage.prepare();
    const reads = readFrozenFiniteAttempt(publication.command.frozenAttempt)?.graph.pageReads;
    expect(reads).toHaveLength(1); expect(reads?.[0]?.entries).toHaveLength(32); expect(reads?.[0]?.isDone).toBe(false);
    expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "published" });
  } finally { await prefixPage.close(); }
  let inspected = 0;
  const cumulative = await open({ instrumentation: { hooks: {}, documentReads: { afterReferencePage: observation => { inspected += observation.inspected; } } } });
  await Effect.runPromise(cumulative.retrieve()); const cumulativePage = await cumulative.bind();
  try {
    const before = await counts();
    let completed = 0, refused = false;
    for (let i = 0; i < 256; i++) {
      const result = await Effect.runPromise(Effect.exit(cumulativePage.invoke({ limit: 1 })));
      if (Exit.isFailure(result)) {
        const error = Cause.findErrorOption(result.cause);
        expect(error).toMatchObject({ value: { cause: { reason: "limitExceeded" } } });
        refused = true; break;
      }
      expect(result.value).toMatchObject({ kind: "completed", result: { docs: [{ id: ids[0] }], hasMore: true } }); completed++;
    }
    expect(refused).toBe(true); expect(completed).toBeGreaterThan(1);
    expect(inspected).toBeLessThanOrEqual(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1);
    expect(inspected).toBeGreaterThan(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 - 33);
    await expect(cumulative.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" }); expect(await counts()).toEqual(before);
  } finally { await cumulativePage.close(); }
  await writePolicy([], policyId);
  const capacity = await open(); await Effect.runPromise(capacity.retrieve()); const capacityPage = await capacity.bind();
  try {
    const before = await counts();
    await expect(Effect.runPromise(capacityPage.invoke({ limit: 1 }))).rejects.toMatchObject({ cause: { reason: "limitExceeded" } });
    await expect(capacity.root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" }); expect(await counts()).toEqual(before);
  } finally { await capacityPage.close(); }
}
