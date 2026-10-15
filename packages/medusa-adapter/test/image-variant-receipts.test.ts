import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productLogicalVariantImagesEventPolicy } from "../src/modules/product/events/variant";
import { productCallReceipts } from "../src/modules/product/events/call-receipts";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Mutation = Activity["mutations"][number];
let catalog: ProductRuntimeMetadata;
const stamp = "2026-10-18T03:00:00.000Z";
const url = "https://image-variant.invalid/image.png";
const assignment = (id: string, variant_id = "variant-a", image_id = "image-a"): JsonObject =>
  ({ id, variant_id, image_id, created_at: stamp, updated_at: stamp, deleted_at: null });
const variant = (id: string, thumbnail: string | null = url): JsonObject =>
  ({ id, title: id, product_id: "product-a", thumbnail, metadata: { retained: true },
    created_at: stamp, updated_at: stamp, deleted_at: null });
const image = (): JsonObject => ({ id: "image-a", url, product_id: "product-a", rank: 0,
  created_at: stamp, updated_at: stamp, deleted_at: null });
const activity = (mutations: readonly Mutation[], observedRows: Activity["observedRows"] = []): Activity =>
  ({ mutations, observedRows, lifecycle: [], setNull: [], referenceReplacements: [] });
const call = (commandName: string, input: Json, result: Json, mutations: readonly Mutation[], events: readonly Json[] = []): Receipt =>
  ({ commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: mutations.length, fromLifecycle: 0, toLifecycle: 0 });
const updated = (id: string): Json => ({ name: catalog.variant.updatedEvent,
  metadata: { source: "product", object: catalog.variant.eventObject, action: "updated" }, data: { id } });
const refused = async (policy: LogicalCallReceiptValidation, receipt: Receipt, evidence: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const policy = () => productLogicalVariantImagesEventPolicy(catalog, "imageVariants").validateLogicalCall;

function creation() {
  const rows = [assignment("assignment-a"), assignment("assignment-b"), assignment("assignment-c", "variant-b"), assignment("assignment-d", "variant-c")];
  const mutations: Mutation[] = rows.map((after, ordinal) => ({ ordinal, table: catalog.assignment.table.name,
    operation: "insert", before: null, after }));
  return { rows, mutations, activity: activity(mutations), call: call("productImageWorkflowCreateAssignment",
    rows.map(row => ({ image_id: String(row.image_id), variant_id: String(row.variant_id) })), rows.map(row => ({ id: row.id ?? null })), mutations) };
}
function deletion(count = 8) {
  const rows = Array.from({ length: count }, (_, index) => assignment("assignment-" + index));
  const mutations: Mutation[] = rows.map((before, ordinal) => ({ ordinal, table: catalog.assignment.table.name,
    operation: "delete", before, after: null }));
  // Includes an inactive matching identity and an unrelated active assignment.
  const observed = [...rows, { ...assignment("inactive"), deleted_at: stamp }, assignment("unrelated", "variant-other")];
  return { rows, mutations, activity: activity(mutations, [...observed.map(row => ({ table: catalog.assignment.table.name, row })),
    { table: catalog.image.table.name, row: image() }, { table: catalog.variant.table.name, row: variant("variant-a") }]),
    call: call("productImageWorkflowDeleteAssignment", [
      { image_id: "image-a", variant_id: "variant-a" }, { image_id: "image-a", variant_id: "variant-a" },
    ], null, mutations) };
}
function thumbnails() {
  const roots = [variant("variant-a"), variant("variant-b", "other.png"), variant("variant-c"), variant("variant-outside")];
  const selected = [roots[2], roots[0]];
  const mutations: Mutation[] = selected.map((before, ordinal) => {
    if (before === undefined) throw new Error("Missing fixed Variant");
    return { ordinal, table: catalog.variant.table.name, operation: "patch", before,
      after: { ...before, thumbnail: null, updated_at: "2026-10-18T03:00:01.000Z" } };
  });
  // Pending observations carry updated values; first mutation preimages restore
  // the exact original thumbnail predicate for selection authentication.
  const pending = roots.map(row => mutations.find(mutation => mutation.after?.id === row.id)?.after ?? row);
  return { roots, mutations, activity: activity(mutations, pending.map(row => ({ table: catalog.variant.table.name, row }))),
    call: call("productImageWorkflowUpdateVariantsBySelector", { selector: {
      id: ["variant-c", "variant-a", "variant-b", "variant-c"], thumbnail: url,
    }, update: { thumbnail: null } }, mutations.map(mutation => mutation.after), mutations, [updated("variant-c"), updated("variant-a")]) };
}

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("image-variant-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Image-to-Variants call receipts", () => {
  it("authenticates duplicate requested pairs with distinct ordered assignment identities", async () => {
    const fixed = creation();
    await Effect.runPromise(policy()(fixed.call, fixed.activity));
    await Effect.runPromise(productCallReceipts(catalog).validateLogicalCall(fixed.call, fixed.activity));
  });

  it("binds every create result and mutation to its requested pair and refuses duplicate identities", async () => {
    const fixed = creation(), validate = policy();
    await refused(validate, { ...fixed.call, result: [{ id: "assignment-a" }, { id: "assignment-a" }, { id: "assignment-c" }, { id: "assignment-d" }] }, fixed.activity);
    await refused(validate, { ...fixed.call, result: [{ id: "assignment-b" }, { id: "assignment-a" }, { id: "assignment-c" }, { id: "assignment-d" }] }, fixed.activity);
    for (const field of ["variant_id", "image_id", "deleted_at"]) {
      const mutations = fixed.mutations.map((mutation, index) => index === 0 && mutation.after !== null
        ? { ...mutation, after: { ...mutation.after, [field]: "foreign" } } : mutation);
      await refused(validate, fixed.call, { ...fixed.activity, mutations });
    }
  });

  it("refuses create graphs beyond four raw entries or spanning different Images", async () => {
    const fixed = creation(), validate = policy();
    const extra = assignment("assignment-extra");
    const mutations: Mutation[] = [...fixed.mutations, { ordinal: 4, table: catalog.assignment.table.name, operation: "insert", before: null, after: extra }];
    await refused(validate, call("productImageWorkflowCreateAssignment", [...fixed.rows, extra].map(row => ({ image_id: "image-a", variant_id: String(row.variant_id) })),
      [...fixed.rows, extra].map(row => ({ id: row.id ?? null })), mutations), activity(mutations));
    const pairs = fixed.rows.map((row, index) => ({ image_id: index === 0 ? "image-other" : "image-a", variant_id: String(row.variant_id) }));
    await refused(validate, { ...fixed.call, input: pairs }, fixed.activity);
  });

  it("authenticates eight distinct persisted assignments for repeated requested pairs", async () => {
    const fixed = deletion();
    await Effect.runPromise(policy()(fixed.call, fixed.activity));
    await Effect.runPromise(productCallReceipts(catalog).validateLogicalCall(fixed.call, fixed.activity));
  });

  it("requires the complete matching deletion cohort rather than only actual mutation membership", async () => {
    const fixed = deletion(), validate = policy();
    await refused(validate, { ...fixed.call, toAttempt: 0 }, { ...fixed.activity, mutations: [] });
    const mutations = fixed.mutations.slice(0, -1);
    await refused(validate, { ...fixed.call, toAttempt: mutations.length }, { ...fixed.activity, mutations });
    await refused(validate, { ...fixed.call, result: [] }, fixed.activity);
  });

  it("refuses reordered, repeated, unrelated or ninth assignment deletions", async () => {
    const fixed = deletion(), validate = policy();
    const reversed = [...fixed.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal }));
    await refused(validate, fixed.call, { ...fixed.activity, mutations: reversed });
    const repeated = fixed.mutations.map((mutation, ordinal) => ordinal === 1 && fixed.rows[0] !== undefined
      ? { ...mutation, before: fixed.rows[0] } : mutation);
    await refused(validate, fixed.call, { ...fixed.activity, mutations: repeated });
    const unrelated = fixed.mutations.map((mutation, ordinal) => ordinal === 0 ? { ...mutation, before: assignment("unrelated", "variant-other") } : mutation);
    await refused(validate, fixed.call, { ...fixed.activity, mutations: unrelated });
    const over = deletion(9);
    await refused(validate, over.call, over.activity);
  });

  it("accepts empty and absent assignment cohorts without inventing module messages", async () => {
    const validate = policy();
    await Effect.runPromise(validate(call("productImageWorkflowCreateAssignment", [], [], []), activity([])));
    await Effect.runPromise(validate(call("productImageWorkflowDeleteAssignment", [], null, []), activity([])));
    await Effect.runPromise(validate(call("productImageWorkflowDeleteAssignment", [{ image_id: "image-a", variant_id: "missing" }], null, []), activity([])));
  });

  it("preserves observed assignments when either joined endpoint is inactive or the Variant is absent", async () => {
    const fixed = deletion(2), validate = policy();
    for (const endpoint of [catalog.image.table.name, catalog.variant.table.name]) {
      const observedRows = fixed.activity.observedRows.map(observation => observation.table === endpoint
        ? { ...observation, row: { ...observation.row, deleted_at: stamp } } : observation);
      await Effect.runPromise(validate({ ...fixed.call, toAttempt: 0 }, activity([], observedRows)));
      await refused(validate, fixed.call, { ...fixed.activity, observedRows });
    }
    const orphan = fixed.activity.observedRows.filter(observation => observation.table !== catalog.variant.table.name);
    await Effect.runPromise(validate({ ...fixed.call, toAttempt: 0 }, activity([], orphan)));
    await refused(validate, fixed.call, { ...fixed.activity, observedRows: orphan });
  });

  it("binds the complete OR selection after both endpoint filters without granting inactive rows deletion authority", async () => {
    const visible = assignment("assignment-a"), hidden = assignment("assignment-b", "variant-b");
    const mutations: Mutation[] = [{ ordinal: 0, table: catalog.assignment.table.name, operation: "delete", before: visible, after: null }];
    const observedRows = [
      { table: catalog.assignment.table.name, row: visible }, { table: catalog.assignment.table.name, row: hidden },
      { table: catalog.image.table.name, row: image() }, { table: catalog.variant.table.name, row: variant("variant-a") },
      { table: catalog.variant.table.name, row: { ...variant("variant-b"), deleted_at: stamp } },
    ];
    const receipt = call("productImageWorkflowDeleteAssignment", [
      { image_id: "image-a", variant_id: "variant-b" }, { image_id: "image-a", variant_id: "variant-a" },
    ], null, mutations);
    await Effect.runPromise(policy()(receipt, activity(mutations, observedRows)));
    await refused(policy(), { ...receipt, toAttempt: 0 }, activity([], observedRows));
    const hiddenDelete: Mutation = { ordinal: 1, table: catalog.assignment.table.name, operation: "delete", before: hidden, after: null };
    await refused(policy(), { ...receipt, toAttempt: 2 }, activity([...mutations, hiddenDelete], observedRows));
  });

  it("authenticates full thumbnail DTOs, predicate membership and first-occurrence selector order", async () => {
    const fixed = thumbnails();
    await Effect.runPromise(policy()(fixed.call, fixed.activity));
    await Effect.runPromise(productCallReceipts(catalog).validateLogicalCall(fixed.call, fixed.activity));
  });

  it("refuses a vacuous thumbnail result when an observed matching root exists", async () => {
    const fixed = thumbnails();
    const observedRows = fixed.roots.map(row => ({ table: catalog.variant.table.name, row }));
    await refused(policy(), { ...fixed.call, result: [], events: [], toAttempt: 0 }, activity([], observedRows));
  });

  it("accepts genuine missing and no-thumbnail-match selectors with zero mutations and messages", async () => {
    const receipt = call("productImageWorkflowUpdateVariantsBySelector", {
      selector: { id: ["variant-b", "missing", "variant-b"], thumbnail: url }, update: { thumbnail: null },
    }, [], []);
    await Effect.runPromise(policy()(receipt, activity([], [{ table: catalog.variant.table.name, row: variant("variant-b", "different") }])));
  });

  it("refuses omitted, reordered, partial and fabricated thumbnail results", async () => {
    const fixed = thumbnails(), validate = policy();
    if (!Array.isArray(fixed.call.result)) throw new Error("Missing fixed result array");
    await refused(validate, { ...fixed.call, result: fixed.call.result.slice(0, 1) }, fixed.activity);
    await refused(validate, { ...fixed.call, result: [...fixed.call.result].reverse() }, fixed.activity);
    await refused(validate, { ...fixed.call, result: [{ id: "variant-c", thumbnail: null }, { id: "variant-a", thumbnail: null }] }, fixed.activity);
    const forged = fixed.mutations.map(mutation => ({ ...mutation, after: mutation.after === null ? null : { ...mutation.after, title: "forged" } }));
    await refused(validate, { ...fixed.call, result: forged.map(mutation => mutation.after) }, { ...fixed.activity, mutations: forged });
  });

  it("refuses extra or reordered mutations and matching the wrong original thumbnail", async () => {
    const fixed = thumbnails(), validate = policy();
    const reversed = [...fixed.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal }));
    await refused(validate, fixed.call, { ...fixed.activity, mutations: reversed });
    const extraBefore = variant("variant-b", "other.png");
    const extra: Mutation = { ordinal: 2, table: catalog.variant.table.name, operation: "patch", before: extraBefore, after: { ...extraBefore, thumbnail: null } };
    await refused(validate, { ...fixed.call, result: [...fixed.mutations.map(mutation => mutation.after), extra.after], toAttempt: 3,
      events: [...fixed.call.events, updated("variant-b")] }, { ...fixed.activity, mutations: [...fixed.mutations, extra] });
    const stale = fixed.mutations.map((mutation, index) => index === 0 && mutation.before !== null
      ? { ...mutation, before: { ...mutation.before, thumbnail: "stale.png" } } : mutation);
    await refused(validate, fixed.call, { ...fixed.activity, mutations: stale });
  });

  it("requires scalar module messages in the exact native mutation order", async () => {
    const fixed = thumbnails(), validate = policy();
    await refused(validate, { ...fixed.call, events: [] }, fixed.activity);
    await refused(validate, { ...fixed.call, events: [...fixed.call.events].reverse() }, fixed.activity);
    await refused(validate, { ...fixed.call, events: [updated("variant-c"), updated("variant-c")] }, fixed.activity);
    const grouped: Json = { name: catalog.variant.updatedEvent, metadata: { source: "product", object: catalog.variant.eventObject, action: "updated" },
      data: { id: ["variant-c", "variant-a"] } };
    await refused(validate, { ...fixed.call, events: [grouped] }, fixed.activity);
  });

  it("confines the new named profile and preserves old scalar Variant-to-Images receipts", async () => {
    const fixed = creation(), validate = policy();
    await refused(validate, { ...fixed.call, commandName: "productCreateassignment" }, fixed.activity);
    await refused(validate, { ...fixed.call, mode: "read" }, fixed.activity);
    await refused(validate, { ...fixed.call, events: [updated("variant-a")] }, fixed.activity);
    const old = productLogicalVariantImagesEventPolicy(catalog).validateLogicalCall;
    await Effect.runPromise(old({ ...fixed.call, commandName: "productCreateassignment" }, fixed.activity));
    const before = variant("variant-a"), after = { ...before, thumbnail: null };
    const mutations: Mutation[] = [{ ordinal: 0, table: catalog.variant.table.name, operation: "patch", before, after }];
    await Effect.runPromise(old(call("productUpdateVariantsBySelector", { selector: { id: "variant-a" }, update: { thumbnail: null } },
      [after], mutations, [updated("variant-a")]), activity(mutations)));
  });
});
