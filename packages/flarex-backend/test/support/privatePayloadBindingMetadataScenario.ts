import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { fxSystemMetadataContractObservations } from "../../../persistence-postgres/src/database/schema";
import { finiteMetadataDependencyIdentity, finiteMetadataContractKey } from "../../../persistence-postgres/src/execution/finiteMetadataDependencies";
import { readFrozenFiniteAttempt } from "../../../persistence-postgres/src/testing/sessionJournalInspection";
import { bindPrivatePayloadSave } from "./privatePayloadSaveCommands";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

/** Named negative metadata-drift probes. Dependencies come from genuine native
 * work and freeze; only the real binding owner stamps a changed sequence. These
 * are not admitted schema migrations or fabricated observation certificates. */
export async function privatePayloadBindingMetadataScenario(fixture: PrivatePayloadSaveFixture,
  policyId: AppDocumentIdV1, productId: string, rebind: () => Promise<void>) {
  const db = fixture.fixture.application.persistence.drizzle;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const counts = () => publishedScopeCounts(db, scopeId);
  for (const mode of ["missing", "changed", "aba", "unrelated"] as const) {
    const root = await fixture.open();
    const saving = await bindPrivatePayloadSave(fixture, root, policyId);
    try {
      expect(await Effect.runPromise(saving.invoke("create", { collection: "posts",
        data: { title: `Metadata ${mode}`, featuredProduct: productId } })))
        .toMatchObject({ kind: "completed" });
      const table = await Effect.runPromise(fixture.fixture.store.resolvePointTableEffect(root.attempt, "users"));
      await Effect.runPromise(fixture.fixture.store.runPointOperationEffect(table, { kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(3n), fields: { name: "Pending metadata witness" } }, root.validator));
      const publication = await root.preparePublication(null, { logicalOperationProfiles: [root.payloadProfile(saving.selected.profileRevision)] });
      const frozen = readFrozenFiniteAttempt(publication.command.frozenAttempt);
      if (frozen === undefined) throw new Error("Missing authentic frozen save");
      const dependencies = frozen.graph.metadataDependencies ?? [];
      const consumed = dependencies.find(dependency => dependency.namespace === "binding" && dependency.ownerKey === "payload" &&
        dependency.contractKey === finiteMetadataContractKey("writeClosure", "posts"));
      if (consumed === undefined || consumed.observed.kind !== "present") throw new Error("Native save did not consume its write closure");
      const rows = await db.select().from(fxSystemMetadataContractObservations)
        .where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
        .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey,
          fxSystemMetadataContractObservations.contractKey);
      const consumedKeys = new Set(dependencies.map(finiteMetadataDependencyIdentity));
      const stored = mode === "unrelated" ? rows.find(row => row.namespace === "binding" && row.ownerKey === "medusa.product" &&
        row.present && !consumedKeys.has(finiteMetadataDependencyIdentity(row))) :
        rows.find(row => finiteMetadataDependencyIdentity(row) === finiteMetadataDependencyIdentity(consumed));
      if (stored === undefined) throw new Error("Missing actual consumed/unconsumed metadata row");
      const identity = and(eq(fxSystemMetadataContractObservations.scopeId, scopeId),
        eq(fxSystemMetadataContractObservations.namespace, stored.namespace),
        eq(fxSystemMetadataContractObservations.ownerKey, stored.ownerKey),
        eq(fxSystemMetadataContractObservations.contractKey, stored.contractKey));
      const before = await counts();
      let reconciled = false;
      if (mode === "missing") await db.delete(fxSystemMetadataContractObservations).where(identity);
      else await db.update(fxSystemMetadataContractObservations).set({ semanticSha256Hex: "f".repeat(64) }).where(identity);
      try {
        if (mode === "aba" || mode === "unrelated") {
          // No fixture sequence assignment: activation restores its genuine
          // current projection and records this repair through the real owner.
          await rebind();
          reconciled = true;
          const [restored] = await db.select().from(fxSystemMetadataContractObservations).where(identity);
          expect(restored).toMatchObject({ present: stored.present, semanticSha256Hex: stored.semanticSha256Hex,
            semanticBytes: stored.semanticBytes });
          if (restored === undefined) throw new Error("Activation did not restore actual metadata");
          expect(restored.lastChangedMetadataSequence).toBeGreaterThan(consumed.capturedWatermark);
        }
        const result = await Effect.runPromise(publication.publish.pipe(Effect.result));
        if (mode === "unrelated") {
          expect(result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
          expect(await counts()).toMatchObject({ rows: before.rows + 2, revisions: before.revisions + 2,
            commits: before.commits + 1, outcomes: before.outcomes + 1 });
        } else {
          expect(result).toMatchObject(mode === "aba" ? { _tag: "Failure", failure: { _tag: "PointCommitConflictV1Error",
            conflict: { kind: "metadata", namespace: consumed.namespace, ownerKey: consumed.ownerKey, contractKey: consumed.contractKey } } } :
            { _tag: "Failure", failure: { _tag: "PointCommitCorruptionV1Error", reason: "dependencySetInvalid" } });
          expect(await counts()).toEqual(before);
        }
      } finally {
        if (!reconciled) {
          if (mode === "missing") await db.insert(fxSystemMetadataContractObservations).values(stored);
          else await db.update(fxSystemMetadataContractObservations).set(stored).where(identity);
        }
      }
    } finally { await saving.close(); }
  }
}
