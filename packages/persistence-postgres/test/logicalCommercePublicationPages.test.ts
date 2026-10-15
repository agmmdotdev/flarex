import { expect, it } from "vitest";
import { Result } from "effect";
import { CatalogTableIdSchema, CatalogUniqueConstraintDefinitionIdSchema, CatalogUniqueConstraintIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { canonicalizeFlarexValueV1, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { canonicalizeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { markLocatedDefinition } from "../src/storage/unique/locatedAppUniqueConstraintDefinition";
import type { LogicalDocumentAttempt, LogicalDocumentChange } from "../src/storage/documents/logicalDocuments/workingSet";
import { planLogicalCommercePublicationPages } from "../src/frameworks/commerceTransaction/logicalPublicationPages";

const tableId = CatalogTableIdSchema.make(1), seq = CommitSeqSchema.make(1n);
const costs = new Map([[tableId, { indexes: 0, unique: 1 }]]);
async function definition() {
  const canonical = await canonicalizeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
    orderedFields: ["code"], sparse: false, localePolicy: { kind: "none" },
    keyCodecIdentity: "flarex.unique-key/ordered-index-components/v1", keyCodecVersion: 1 });
  return markLocatedDefinition(ScopeIdSchema.make("planner-scope"), CatalogSchemaVersionIdSchema.make("planner-schema"), {
    deploymentId: "planner-deployment", uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema.make(1),
    logicalUniqueConstraintId: CatalogUniqueConstraintIdSchema.make(1), tableId,
    physicalSpecCodecVersion: canonical.codecVersion, physicalSpec: canonical.physicalSpec,
    physicalSpecBytesHex: canonical.canonicalBytesHex, physicalSpecSha256Hex: canonical.sha256Hex, createdAt: new Date(0),
  });
}
async function entry(index: number, previous: string | null, next: string | null) {
  const rowId = decodeAppRowIdHexV1((index + 1).toString(16).padStart(32, "0"));
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const canonical = (code: string): Promise<CanonicalFlarexValueV1> => canonicalizeFlarexValueV1({ code }, "appDocument");
  const before = previous === null ? null : await canonical(previous), after = next === null ? null : await canonical(next);
  const dependency = previous === null
    ? { kind: "appRowPoint" as const, documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } }
    : { kind: "appRowPoint" as const, documentId, observed: { kind: "present" as const, revisionCommitSeq: seq } };
  const point = { documentId, tableId, rowId, readAt: seq, dependency };
  const change: LogicalDocumentChange = after === null ? { ...point, kind: "deleted" }
    : { ...point, kind: "live", creationTime: AppCreationTimeV1Schema.make(1), document: after };
  const attempt: LogicalDocumentAttempt = { ordinal: index, documentId, operation: before === null ? "insert" : after === null ? "delete" : "patch",
    tableId, tableName: "probe", before, after };
  return { change, attempt };
}
const unpack = (entries: readonly Awaited<ReturnType<typeof entry>>[]) => ({ changes: entries.map(value => value.change), attempts: entries.map(value => value.attempt) });

it("keeps canonical release/claim components together across an ordinary packet boundary", async () => {
  const unique = await definition();
  const entries = await Promise.all([entry(0, "adjacent", null), entry(1, null, "adjacent"), entry(2, "distant", null),
    ...Array.from({ length: 125 }, (_, index) => entry(index + 3, null, `fresh-${index}`)), entry(128, null, "distant")]);
  const { changes, attempts } = unpack(entries);
  const pages = Result.getOrThrow(planLogicalCommercePublicationPages(changes, attempts, [unique], costs, 256, "mixed"));
  expect(pages.map(page => page.length)).toEqual([128, 1]);
  for (const [left, right] of [[0, 1], [2, 128]]) {
    if (left === undefined || right === undefined) throw new Error("Missing transfer pair");
    const previous = changes[left], next = changes[right];
    if (previous === undefined || next === undefined) throw new Error("Missing transfer member");
    expect(pages.findIndex(page => page.includes(previous))).toBe(pages.findIndex(page => page.includes(next)));
  }
  expect(pages[0]?.slice(0, 4)).toEqual([changes[0], changes[1], changes[2], changes[128]]);
  expect(pages.flat()).toHaveLength(129);
  expect(new Set(pages.flat()).size).toBe(129);
  // Planning never changes the source/fact order supplied by the closure.
  expect(changes).toEqual(entries.map(value => value.change));
});

it("refuses a transitive transfer component larger than one physical packet", async () => {
  const unique = await definition();
  const entries = await Promise.all([entry(0, "key-0", null),
    ...Array.from({ length: 127 }, (_, index) => entry(index + 1, `key-${index + 1}`, `key-${index}`)), entry(128, null, "key-127")]);
  const { changes, attempts } = unpack(entries);
  expect(planLogicalCommercePublicationPages(changes, attempts, [unique], costs, 256, "mixed"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("requires explicit publication admission independently of the working-set identity ceiling", async () => {
  const entries = await Promise.all([entry(0, "deleted", null), ...Array.from({ length: 128 }, (_, index) => entry(index + 1, null, `new-${index}`))]);
  const { changes, attempts } = unpack(entries);
  for (const maximum of [128, 256, 2048]) expect(planLogicalCommercePublicationPages(changes, attempts, [], costs, maximum))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(planLogicalCommercePublicationPages(changes, attempts, [], costs, 2048, "mixed"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded", cause: { maximumIdentities: 2048, changes: 129, pages: 2 } } });
  expect(Result.getOrThrow(planLogicalCommercePublicationPages(changes, attempts, [], costs, 256, "mixed")).map(page => page.length)).toEqual([128, 1]);
  const overMaximum = [...changes, ...changes];
  expect(planLogicalCommercePublicationPages(overMaximum, attempts, [], costs, 256, "mixed"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("admits explicit mixed packets inside an unchanged 128-identity source budget", async () => {
  const entries = await Promise.all([entry(0, "deleted", null), ...Array.from({ length: 69 }, (_, index) => entry(index + 1, null, `new-${index}`))]);
  const { changes, attempts } = unpack(entries), twoKeys = new Map([[tableId, { indexes: 2, unique: 2 }]]);
  expect(planLogicalCommercePublicationPages(changes, attempts, [], twoKeys, 128))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(Result.getOrThrow(planLogicalCommercePublicationPages(changes, attempts, [], twoKeys, 128, "mixed")).map(page => page.length)).toEqual([64, 6]);
});

it("retains existing pure-create and pure-delete batching independently of the mixed profile", async () => {
  for (const deletion of [false, true]) {
    const entries = await Promise.all(Array.from({ length: 130 }, (_, index) => entry(index,
      deletion ? `old-${index}` : null, deletion ? null : `new-${index}`)));
    const { changes, attempts } = unpack(entries);
    expect(Result.getOrThrow(planLogicalCommercePublicationPages(changes, attempts, [], costs, 2048)).map(page => page.length)).toEqual([128, 2]);
  }
});
