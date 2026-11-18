import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { AppDocumentIdV1Schema } from "flarex-protocol/app-document-id";
import { dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { readFrozenFiniteAttempt } from "../../../persistence-postgres/src/testing/sessionJournalInspection";
import { bindPrivatePayloadSave, preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { openPrivateReverseRead, preparePrivateReverseReadPolicy } from "./privatePayloadReverseReadCommands";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

export interface PrivateReverseReadOrder {
  readonly first: "read" | "change";
  readonly activation: boolean;
  readonly scopeId: string;
  readonly read: () => Promise<void>;
  readonly change: () => Promise<void>;
}
export type PrivateReverseReadCoordinator = (input: PrivateReverseReadOrder) => Promise<void>;
export const serialPrivateReverseReadOrder: PrivateReverseReadCoordinator = async input => {
  if (input.first === "read") { await input.read(); await input.change(); }
  else { await input.change(); await input.read(); }
};
const productResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const articleResult = Schema.decodeUnknownSync(Schema.Struct({ id: AppDocumentIdV1Schema }));

/** The coordinator schedules genuine owners; all permissions, snapshots,
 * native execution, dependency validation and settlement belong to the system. */
export async function privatePayloadReverseFreshnessScenario(fixture: PrivatePayloadSaveFixture, coordinate: PrivateReverseReadCoordinator) {
  const { store, application } = fixture.fixture;
  const scopeId = application.authority.scopeId;
  const counts = () => publishedScopeCounts(application.persistence.drizzle, scopeId);
  let number = 0;
  for (const mode of ["enumerate", "article", "insert", "remove", "source", "target", "softDelete", "withdrawal"] as const) {
    for (const first of ["change", "read"] as const) {
      const product = productResult(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
        fixture.productRuntime.commands.internalProductCreate, { title: mode, handle: `rr3-${++number}` })));
      const savePolicy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] });
      await savePolicy.root.publish();
      const seed = await fixture.open();
      const writer = await bindPrivatePayloadSave(fixture, seed, savePolicy.documentId);
      let articleId;
      try {
        const created = await Effect.runPromise(writer.invoke("create", { collection: "posts", data: { title: "Original article",
          ...(mode === "insert" ? {} : { featuredProduct: product.id }) } }));
        if (created.kind !== "completed") throw new Error("Seed refused");
        articleId = articleResult(created.result).id;
        expect(await seed.publish(null, [seed.payloadProfile(writer.selected.profileRevision)])).toMatchObject({ kind: "published" });
      } finally { await writer.close(); }
      const policy = await preparePrivateReverseReadPolicy(fixture, { enumerate: [product.id], articles: [articleId] });
      await policy.root.publish();
      const reading = await openPrivateReverseRead(fixture, policy.documentId, policy.root.principal, product.id);
      expect(await Effect.runPromise(reading.retrieve())).toMatchObject({ kind: "completed" });
      const bound = await reading.bind();
      try {
        const page = await bound.read(1);
        expect(page.docs.map(doc => doc.id)).toEqual(mode === "insert" ? [] : [articleId]);
        const users = await Effect.runPromise(store.resolvePointTableEffect(reading.root.attempt, "users"));
        expect(await Effect.runPromise(store.runPointOperationEffect(users, { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(4n),
          fields: { name: JSON.stringify(page.docs) } }, reading.root.validator))).toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
        const publication = await bound.prepare();
        const graph = readFrozenFiniteAttempt(publication.command.frozenAttempt)?.graph;
        expect(graph?.pageReads).toHaveLength(1);
        expect(graph?.pageReads[0]).toMatchObject({ isDone: true, entries: mode === "insert" ? [] : expect.any(Array) });
        expect(graph?.dependencies.some(dependency => dependency.documentId === articleId)).toBe(mode !== "insert");
        const before = await counts();
        let readFailure: unknown;
        let changedCounts: Awaited<ReturnType<typeof counts>> | undefined;
        let disposeChange = async () => {};
        const prepareChange = async (): Promise<() => Promise<void>> => {
          if (mode === "enumerate" || mode === "article") {
            const changed = await preparePrivateReverseReadPolicy(fixture, { enumerate: mode === "enumerate" ? [] : [product.id],
              articles: mode === "article" ? [] : [articleId] }, policy.documentId);
            return async () => { expect(await changed.root.publish()).toMatchObject({ kind: "published" }); };
          }
          if (mode === "insert" || mode === "remove" || mode === "source") {
            const root = await fixture.open(), save = await bindPrivatePayloadSave(fixture, root, savePolicy.documentId);
            disposeChange = save.close;
            expect(await Effect.runPromise(save.invoke("update", { collection: "posts", id: articleId, data:
              mode === "source" ? { title: "Changed article" } : { featuredProduct: mode === "insert" ? product.id : null } })))
              .toMatchObject({ kind: "completed" });
            return async () => { expect(await root.publish(null, [root.payloadProfile(save.selected.profileRevision)])).toMatchObject({ kind: "published" }); };
          }
          if (mode === "target" || mode === "softDelete") return async () => {
            await Effect.runPromise(mode === "target" ? fixture.productHost.run(fixture.productHost.newRequestKey(),
              fixture.productRuntime.commands.internalProductUpdate, { id: product.id, title: "Changed Product" }) :
              fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductSoftDelete, product.id));
          };
          const { binding, frame } = fixture.schemaBinding;
          const application = await Effect.runPromise(binding.readApplicationReference());
          const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
          const candidate = await Effect.runPromise(binding.prepare({ ...frame, application, payloadLifecycle: null }));
          const request = dataBindingActivationRequest(scopeId, application.storageGeneration, `rr3-withdraw-${number}`, candidate.sha256, current.head);
          return async () => { await Effect.runPromise(binding.activate(request)); };
        };
        try {
          const preparedChange = await prepareChange();
          const change = async () => { await preparedChange(); changedCounts = await counts(); };
          await coordinate({ first, activation: mode === "withdrawal", scopeId, change, read: async () => {
            const outcome = await Effect.runPromise(publication.publish.pipe(Effect.result));
            if (outcome._tag === "Failure") readFailure = outcome.failure;
            else expect(outcome.success).toMatchObject({ kind: "published" });
          } });
        } finally { await disposeChange(); }
        if (first === "change") {
          expect(readFailure, `${mode}: stale native page must refuse Application publication`).toMatchObject(mode === "withdrawal" ?
            { _tag: "PointCommitStaleAuthorityV1Error", reason: "revocationEpochChanged" } : { _tag: "PointCommitConflictV1Error" });
          expect(await counts()).toEqual(changedCounts);
        } else {
          expect(readFailure).toBeUndefined();
          expect((await counts()).commits).toBe(before.commits + (mode === "withdrawal" ? 1 : 2));
        }
      } finally { await bound.close(); }
      if (mode === "withdrawal") {
        const { binding, frame } = fixture.schemaBinding;
        const application = await Effect.runPromise(binding.readApplicationReference());
        const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
        const candidate = await Effect.runPromise(binding.prepare({ ...frame, application }));
        await Effect.runPromise(binding.activate(dataBindingActivationRequest(scopeId, application.storageGeneration, `rr3-restore-${number}`, candidate.sha256, current.head)));
      }
    }
  }
}
