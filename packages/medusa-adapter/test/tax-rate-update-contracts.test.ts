import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCommerceInput } from "../src/value/input";
import { commerceDecoder } from "../src/value/decoder";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { TaxRateUpdateWorkflowInput, decodeTaxRateUpdateInput, decodeTaxRateUpdateUpserts } from "../src/modules/tax/rate-update-input";
import { prepareTaxRateUpdateRepository } from "../src/modules/tax/rate-update-repository";

let prepared: Result.Result.Success<ReturnType<typeof prepareTaxRateUpdateRepository>>;
const stamp = "2020-01-02T03:04:05.000Z";
const row = { id: "rate168", tax_region_id: "region168", name: "Original", code: "ORIGINAL", rate: 7,
  is_default: false, is_combinable: false, metadata: { owner: "original", nested: { retained: true } },
  created_by: "creator168", created_at: stamp, updated_at: stamp, deleted_at: null };
const region = { id: "region168", country_code: "us", province_code: null, metadata: null, created_by: null,
  provider_id: "tp_system", parent_id: null, created_at: stamp, updated_at: stamp, deleted_at: null };
beforeAll(async () => {
  prepared = Result.getOrThrow(prepareTaxRateUpdateRepository((await Effect.runPromise(captureTaxMetadata())).frame));
});

describe("bounded native Tax Rate update contracts", () => {
  it("preserves raw selector positions and only the executing public update fields", () => {
    const input = { selector: { id: Array.from({ length: 8 }, () => "rate168") },
      update: { name: "Changed", code: null, rate: 0.1, is_default: false, is_combinable: true,
        metadata: { nested: { replacement: true } }, updated_by: "actor168" } };
    expect(Result.getOrThrow(decodeTaxRateUpdateInput(input))).toEqual(input);
    expect(Result.getOrThrow(decodeTaxRateUpdateInput({ selector: { tax_region_id: ["region168"], code: ["ORIGINAL"] }, update: {} })))
      .toEqual({ selector: { tax_region_id: ["region168"], code: ["ORIGINAL"] }, update: {} });
    for (const update of [{ id: "other" }, { created_by: "other" }, { tax_region_id: "other" }, { rules: [] }])
      expect(Result.isFailure(decodeTaxRateUpdateInput({ selector: { id: "rate168" }, update }))).toBe(true);
    expect(Result.isFailure(decodeTaxRateUpdateInput({ selector: { id: Array.from({ length: 9 }, () => "rate168") }, update: {} }))).toBe(true);
    expect(Result.isFailure(decodeTaxRateUpdateInput({ selector: { id: "rate168", code: "ORIGINAL" }, update: {} }))).toBe(true);
  });

  it("admits the workflow's raw Rule templates separately from the cleaned Rate data", () => {
    const decode = commerceDecoder(TaxRateUpdateWorkflowInput, "invalidInput");
    const input = { selector: { id: "rate168" }, update: { updated_by: "actor168", rules: [
      { reference: "product", reference_id: "product168", created_by: "overwritten-native-creator", metadata: [null, false] },
    ] } };
    expect(Result.getOrThrow(captureCommerceInput(input).pipe(Result.flatMap(decode)))).toEqual(input);
    expect(Result.isFailure(decodeTaxRateUpdateInput(input))).toBe(true);
  });

  it("refuses caller accessors without evaluating them", () => {
    let invoked = false;
    expect(Result.isFailure(decodeTaxRateUpdateInput({ selector: { id: "rate168" },
      get update() { invoked = true; return {}; } }))).toBe(true);
    expect(invoked).toBe(false);
  });

  it("retains whole metadata and primary keys while ignoring only the named transient actor", () => {
    for (const [select, expected] of [
      [["metadata.nested.retained", "updated_by"], { id: row.id, metadata: row.metadata }],
      [["updated_by"], { id: row.id }],
      [[], { id: row.id, tax_region_id: row.tax_region_id, tax_region: { id: row.tax_region_id } }],
    ] as const) {
      const envelope = Result.getOrThrow(captureCommerceInput(buildQuery({ id: row.id }, { select: [...select], order: { id: "ASC" } })));
      const plan = Result.getOrThrow(prepared.query(envelope));
      expect(Result.getOrThrow(prepared.projectRows([row], plan))).toEqual([expected]);
    }
    const invalid = Result.getOrThrow(captureCommerceInput(buildQuery({ id: row.id }, { select: ["other_transient"], order: { id: "ASC" } })));
    expect(Result.isFailure(prepared.query(invalid))).toBe(true);
  });

  it("separates checked persisted scalars, immediate actor/reference DTOs and inverse reference hydration", () => {
    const forward = Result.getOrThrow(prepared.contracts.present(row, "actor168"));
    expect(Result.getOrThrow(prepared.contracts.decodeRows([forward]))).toEqual([{ ...row,
      tax_region: { id: row.tax_region_id }, updated_by: "actor168" }]);
    expect(Result.isFailure(prepared.contracts.decodeRateRow(forward))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRows([{ ...forward, rules: [] }]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRows([{ ...forward, tax_region: { id: "foreign" } }]))).toBe(true);
    const inverse = Result.getOrThrow(prepared.contracts.present(row, undefined, true));
    expect(Result.getOrThrow(prepared.contracts.decodeUpsertRows([inverse]))).toEqual([{ ...row,
      tax_region: { id: row.tax_region_id, children: [] } }]);
    expect(Result.isFailure(prepared.contracts.decodeRows([inverse]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeUpsertRows([forward]))).toBe(true);
  });

  it("applies native Region filtering to default and empty projections independently of narrow preimages", () => {
    for (const select of [undefined, []]) {
      const envelope = Result.getOrThrow(captureCommerceInput(buildQuery({ id: row.id }, {
        ...(select === undefined ? {} : { select }), order: { id: "ASC" },
      })));
      expect(Result.getOrThrow(prepared.query(envelope))).toMatchObject({ regionFilter: true, regionReference: true });
    }
    for (const select of [["id"], ["name"], ["rate", "code", "is_default", "is_combinable"], ["metadata.nested.retained"], ["updated_by"]]) {
      const envelope = Result.getOrThrow(captureCommerceInput(buildQuery({ id: row.id }, { select, order: { id: "ASC" } })));
      expect(Result.getOrThrow(prepared.query(envelope))).toMatchObject({ regionFilter: false, regionReference: false });
    }
    for (const field of ["tax_region_id", "tax_region", "created_at", "updated_at", "deleted_at", "created_by"]) {
      const envelope = Result.getOrThrow(captureCommerceInput(buildQuery({ id: row.id }, { select: [field], order: { id: "ASC" } })));
      expect(Result.isFailure(prepared.query(envelope))).toBe(true);
    }
  });

  it("checks every Region support body before selecting active parent membership", () => {
    const otherRate = { ...row, id: "rate168-other", tax_region_id: "region168-deleted" };
    const deleted = { ...region, id: otherRate.tax_region_id, deleted_at: stamp };
    expect(Result.getOrThrow(prepared.regionPredicate([row, { ...row, id: "same-parent168" }, otherRate]))).toEqual({
      kind: "and", children: [{ kind: "in", column: "id", values: [region.id, deleted.id] }, { kind: "isNull", column: "deleted_at" }],
    });
    expect(Result.getOrThrow(prepared.contracts.decodeRegionRow(region))).toEqual(region);
    expect(Result.getOrThrow(prepared.filterActiveRegionRates([row, otherRate], [region, deleted, { ...region, id: "unrelated168" }]))).toEqual([row]);
    expect(Result.getOrThrow(prepared.filterActiveRegionRates([otherRate], [deleted]))).toEqual([]);
    expect(Result.isFailure(prepared.filterActiveRegionRates([row], [region, { id: "malformed-unrelated168" }]))).toBe(true);
    expect(Result.isFailure(prepared.filterActiveRegionRates([row], [region, { ...region, deleted_at: stamp }]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRegionRow({ ...region, invented: true }))).toBe(true);
  });

  it("preserves sparse retained inputs and their required-code creation failure", () => {
    for (const input of [[{ id: row.id, name: row.name }], [{ id: row.id }],
      [{ id: row.id, tax_region_id: row.tax_region_id, tax_region: { id: row.tax_region_id } }]])
      expect(Result.getOrThrow(decodeTaxRateUpdateUpserts(input))).toEqual(input);
    expect(Result.isFailure(decodeTaxRateUpdateUpserts([{ id: row.id, name: row.name, code: row.code,
      tax_region_id: row.tax_region_id, tax_region: { id: row.tax_region_id } }]))).toBe(true);
    const missing = prepared.contracts.decodeCreation({ id: row.id, name: row.name });
    expect(missing).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    if (Result.isFailure(missing)) {
      expect(missing.failure.cause).toBeDefined(); expect(String(missing.failure.cause)).toContain("code");
    }
  });
});
