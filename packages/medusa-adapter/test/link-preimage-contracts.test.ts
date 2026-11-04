import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { LinkPreimageOperationRequestSchema, LinkPreimageOperationRecordSchema, LinkPreimageRowSchema,
  LinkOperationRecordSchema, linkPreimageRequestKey, linkPreimageRowKey } from "@medusajs/link-modules";
import { captureCartPromotionLinkMetadata, compileCartPromotionLinkCoreDefinition } from "../src/links/cart-promotion-schema";
import { captureCartPromotionCreationLinkMetadata, compileCartPromotionCreationLinkCoreDefinition } from "../src/links/cart-promotion-creation-schema";

const row = { id: "original-link", primary: "cart", foreign: "promotion", created_at: "2026-01-01T00:00:00.123456Z",
  updated_at: "2026-01-01T00:00:00.234567Z", deleted_at: null };
const pair = { primary: row.primary, foreign: row.foreign };
const request = { kind: "preimage", operationId: "operation", mutations: [
  { action: "dismiss", pairs: [pair] }, { action: "create", pairs: [pair] },
] };
const after = { ...row, id: "replacement-link" };
const applied = { id: "operation", service_name: "cart-promotion", request, state: "applied",
  changes: [{ ...pair, before: row, after, afterRevision: "forward-revision" }], events: [], compensation_events: [] };
const decode = Schema.decodeUnknownSync(LinkPreimageOperationRecordSchema, { onExcessProperty: "error" });

describe("native ordered Link preimage protocol", () => {
  it("keeps the exact genuine Link row and indexes in the explicit preimage profile", async () => {
    const original = await Effect.runPromise(captureCartPromotionLinkMetadata()), selected = await Effect.runPromise(captureCartPromotionCreationLinkMetadata());
    expect(selected.frame).toEqual(original.frame);
    expect(original.joiner.databaseConfig?.preimageOperations).toBeUndefined();
    expect(selected.joiner.databaseConfig).toMatchObject({ workflowOperations: true, preimageOperations: true });
  });
  it("retains the one-table read profile and defines a distinct fresh three-table source", async () => {
    const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };
    const [read, preimage] = await Effect.runPromise(Effect.all([
      compileCartPromotionLinkCoreDefinition(target), compileCartPromotionCreationLinkCoreDefinition(target),
    ]));
    expect(read.tables.map(table => table.localName)).toEqual(["cart_promotion"]);
    expect(preimage.tables.map(table => table.localName).toSorted()).toEqual(["cart_promotion", "link_pair_revision", "link_workflow_operation"]);
    expect(read.identity.sourceKey).not.toBe(preimage.identity.sourceKey);
  });
  it("retains exact microseconds and milliseconds without normalizing a stored timestamp", () => {
    const read = Schema.decodeUnknownSync(LinkPreimageRowSchema, { onExcessProperty: "error" });
    expect(read(row)).toEqual(row);
    expect(read({ ...row, created_at: "2026-01-01T00:00:00.123Z" }).created_at).toBe("2026-01-01T00:00:00.123Z");
    for (const created_at of ["0000-01-01T00:00:00.123456Z", "2026-02-30T00:00:00.123456Z", "2026-01-01T24:00:00.123456Z", "2026-01-01T00:00:00Z", new Date()])
      expect(() => read({ ...row, created_at })).toThrow();
    expect(linkPreimageRowKey(row)).not.toBe(linkPreimageRowKey({ ...row, updated_at: "2026-01-01T00:00:00.234568Z" }));
  });
  it("binds native dismiss/create order and rejects caller-supplied preimages", () => {
    const parsed = Schema.decodeUnknownSync(LinkPreimageOperationRequestSchema, { onExcessProperty: "error" })(request);
    expect(linkPreimageRequestKey(parsed)).not.toBe(linkPreimageRequestKey({ ...parsed, mutations: [...parsed.mutations].reverse() }));
    expect(() => Schema.decodeUnknownSync(LinkPreimageOperationRequestSchema, { onExcessProperty: "error" })({ ...request, before: row })).toThrow();
  });
  it("records equal-membership replacements and requires a fence for every requested target", () => {
    expect(decode(applied)).toEqual(applied);
    expect(() => decode({ ...applied, changes: [] })).toThrow();
    expect(() => decode({ ...applied, changes: [applied.changes[0], applied.changes[0]] })).toThrow();
    expect(() => decode({ ...applied, changes: [{ ...applied.changes[0], after: { ...after, foreign: "other-promotion" } }] })).toThrow();
    expect(() => Schema.decodeUnknownSync(LinkOperationRecordSchema, { onExcessProperty: "error" })(applied)).toThrow();
  });
  it("requires exact restored rows and retained generations for completed inverses", () => {
    const completed = { ...applied, state: "compensated", changes: [{ ...applied.changes[0], compensated: row, compensatedRevision: "inverse-revision" }] };
    expect(decode(completed)).toEqual(completed);
    expect(() => decode({ ...applied, state: "compensated" })).toThrow();
    expect(() => decode({ ...completed, changes: [{ ...completed.changes[0], compensated: after }] })).toThrow();
    const created = { ...completed, changes: [{ ...completed.changes[0], before: null,
      compensated: { ...after, deleted_at: "2026-01-02T00:00:00.123456Z" } }] };
    expect(decode(created)).toEqual(created);
    expect(() => decode({ ...created, changes: [{ ...created.changes[0], compensated: null }] })).toThrow();
    expect(() => decode({ ...created, changes: [{ ...created.changes[0], compensated: { ...row, deleted_at: "2026-01-02T00:00:00.123456Z" } }] })).toThrow();
  });
});
