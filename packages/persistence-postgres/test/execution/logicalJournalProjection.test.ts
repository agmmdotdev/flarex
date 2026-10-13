import { Cause, Effect, Exit, Result } from "effect";
import { expect, it } from "vitest";
import { CatalogTableIdSchema, CatalogUniqueConstraintDefinitionIdSchema } from "flarex-protocol/catalog";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { LogicalMetadataReadDependencySchema, MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { projectLogicalDocumentJournalContribution } from "../../src/storage/documents/logicalDocuments/journalContribution";
import { serializeLogicalParticipantDependencyEvidence } from "../../src/storage/documents/logicalDocuments/journalEvidence";
import type { LogicalDocumentChanges, LogicalUniqueRead } from "../../src/storage/documents/logicalDocuments/workingSet";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";

const empty = (): LogicalDocumentChanges => ({ changes: [], attempts: [], lifecycle: [], observedRows: [], noFinalRows: [],
  dependencies: [], scans: [], uniqueReads: [], indexReads: [], pageReads: [], searchReads: [], setNull: [], referenceReplacements: [] });
const tableId = CatalogTableIdSchema.make(1), rowId = decodeAppRowIdHexV1("01".repeat(16));
const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
const point = { tableId, rowId, documentId, readAt: CommitSeqSchema.make(1n),
  dependency: { kind: "appRowPoint" as const, documentId,
    observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } };
const unique = (localeKey: string | null): LogicalUniqueRead => ({ constraintId: CatalogUniqueConstraintDefinitionIdSchema.make(1),
  key: { sparse: false, localeKey, values: [] }, owner: null });

it("keeps contribution construction lazy and first identity refusal ahead of a later defect", async () => {
  const later = new Error("later attempts getter"), seen: string[] = [];
  const graph = (valid: boolean): LogicalDocumentChanges => ({ ...empty(),
    dependencies: [{ ...point, tableId: valid ? tableId : CatalogTableIdSchema.make(2) }],
    get attempts(): never { seen.push("attempts"); throw later; } });
  const effect = projectLogicalDocumentJournalContribution(graph(false));
  expect(seen).toEqual([]);
  expect(await runEffectFailure(effect)).toMatchObject({ reason: "invalidEvidence" });
  expect(seen).toEqual([]);
  const exit = await runEffect(Effect.exit(projectLogicalDocumentJournalContribution(graph(true))));
  if (!Exit.isFailure(exit)) throw new Error("Expected original defect");
  expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(later));
  expect(seen).toEqual(["attempts"]);
});

it("retains unique-key refusal before a later key getter and retains the original getter defect", async () => {
  const later = new Error("later unique key"), seen: string[] = [];
  const tail: LogicalUniqueRead = { constraintId: CatalogUniqueConstraintDefinitionIdSchema.make(2), owner: null,
    get key(): never { seen.push("key"); throw later; } };
  const invalid = serializeLogicalParticipantDependencyEvidence({ ...empty(), uniqueReads: [unique("INVALID LOCALE"), tail] });
  expect(seen).toEqual([]);
  expect(await runEffectFailure(invalid)).toMatchObject({ reason: "invalidEvidence", cause: { field: "localeKey" } });
  expect(seen).toEqual([]);
  const exit = await runEffect(Effect.exit(serializeLogicalParticipantDependencyEvidence({ ...empty(), uniqueReads: [unique(null), tail] })));
  if (!Exit.isFailure(exit)) throw new Error("Expected original unique defect");
  expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(later));
  expect(seen).toEqual(["key"]);
});

it("retains metadata encoding before index projection and preserves Schema error classification", async () => {
  const watermark = MetadataSequenceSchema.make(1n), later = new Error("later index projection");
  const dependency = LogicalMetadataReadDependencySchema.make({ kind: "metadata", namespace: "binding", ownerKey: "source",
    contractKey: "contract", capturedWatermark: watermark, observed: { kind: "present", semanticSha256Hex: "a".repeat(64) } });
  const graph: LogicalDocumentChanges = { ...empty(), metadataWatermark: watermark,
    metadataDependencies: [{ ...dependency, observed: { kind: "present", semanticSha256Hex: "bad" } }],
    get indexReads(): never { throw later; } };
  expect(await runEffectFailure(serializeLogicalParticipantDependencyEvidence(graph)))
    .toMatchObject({ reason: "invalidEvidence", cause: { _tag: "SchemaError" } });
});

it("preserves ordered contribution and dependency evidence on a valid graph", async () => {
  const graph: LogicalDocumentChanges = { ...empty(), dependencies: [point], uniqueReads: [unique(null), unique("en")] };
  const contribution = await runEffect(projectLogicalDocumentJournalContribution(graph));
  expect(contribution.points).toEqual([{ observation: point, overlay: { kind: "retain" } }]);
  const serialized = await runEffect(serializeLogicalParticipantDependencyEvidence(graph));
  expect(serialized.evidence.uniqueReads.map(read => read.key.localeKey)).toEqual(["", "en"]);
  expect(serialized.evidenceBytes).toBeGreaterThan(0);
});
