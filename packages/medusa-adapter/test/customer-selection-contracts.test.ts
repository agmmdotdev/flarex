import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureCustomerMetadata } from "../src/modules/customer/schema";
import { compileCustomerSelectionOutput } from "../src/modules/customer/output";
import { decodeCustomerRetrieveArguments, decodeCustomerListArguments, decodeCustomerCreateArguments, decodeCustomerDeleteArguments,
  decodeCustomerSelectionQuery } from "../src/modules/customer/input";

describe("narrow Customer selection contracts", () => {
  it("keeps the genuine scalar ABI and rejects unselected configurations and selectors", () => {
    expect(Result.getOrThrow(decodeCustomerRetrieveArguments(["cus-contract"]))).toEqual(["cus-contract"]);
    expect(Result.getOrThrow(decodeCustomerListArguments([{ email: "raw@example.invalid" }]))).toEqual([{ email: "raw@example.invalid" }]);
    expect(Result.getOrThrow(decodeCustomerListArguments([{ email: "raw@example.invalid", has_account: false }]))).toEqual([{ email: "raw@example.invalid", has_account: false }]);
    expect(Result.getOrThrow(decodeCustomerCreateArguments([{ email: "raw@example.invalid" }]))).toEqual([{ email: "raw@example.invalid" }]);
    expect(Result.getOrThrow(decodeCustomerDeleteArguments(["cus-contract"]))).toEqual(["cus-contract"]);
    for (const value of [["cus-contract", {}], [["cus-contract"]], [""], [null]]) expect(Result.isFailure(decodeCustomerRetrieveArguments(value))).toBe(true);
    for (const value of [[{ email: "raw@example.invalid", has_account: true }], [{ id: "cus-contract" }], [{ email: "raw@example.invalid" }, {}]])
      expect(Result.isFailure(decodeCustomerListArguments(value))).toBe(true);
    for (const value of [[[{ email: "raw@example.invalid" }]], [{ email: "raw@example.invalid", addresses: [] }], [{ email: "raw@example.invalid", id: "supplied" }]])
      expect(Result.isFailure(decodeCustomerCreateArguments(value))).toBe(true);
    for (const value of [[["cus-contract"]], [{ id: "cus-contract" }], ["cus-contract", {}]]) expect(Result.isFailure(decodeCustomerDeleteArguments(value))).toBe(true);
  });

  it("admits native complete reads and refuses arbitrary repository projections or ordering", () => {
    for (const where of [{ id: "cus-contract" }, { email: "raw@example.invalid" }, { email: "raw@example.invalid", has_account: false }]) {
      expect(Result.isSuccess(decodeCustomerSelectionQuery({ where, options: { populate: [] } }))).toBe(true);
      expect(Result.isSuccess(decodeCustomerSelectionQuery({ where, options: { populate: [], orderBy: { id: "ASC" } } }))).toBe(true);
    }
    for (const input of [{ where: {}, options: { populate: [] } }, { where: { id: "cus-contract" }, options: { populate: ["groups"] } },
      { where: { id: "cus-contract" }, options: { populate: [], fields: ["id"] } },
      { where: { id: "cus-contract" }, options: { populate: [], orderBy: { id: "DESC" } } }])
      expect(Result.isFailure(decodeCustomerSelectionQuery(input))).toBe(true);
  });

  it("validates complete native Customer values before accepting creation-only relation initialization", async () => {
    const metadata = await Effect.runPromise(captureCustomerMetadata()), contracts = Result.getOrThrow(compileCustomerSelectionOutput(metadata.frame));
    const stamp = "2026-10-22T00:00:00.000Z";
    const scalar = { id: "cus-contract", email: "raw@example.invalid", has_account: false, company_name: null, first_name: null,
      last_name: null, phone: null, metadata: null, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null },
      created = { ...scalar, groups: [], addresses: [] };
    expect(Result.getOrThrow(contracts.decodeRow(scalar))).toEqual(scalar);
    expect(Result.getOrThrow(contracts.decodeCreatedRow(created))).toEqual(created);
    expect(Result.getOrThrow(contracts.initializeRows([scalar]))).toEqual([created]);
    expect(scalar).not.toHaveProperty("groups"); expect(scalar).not.toHaveProperty("addresses");
    expect(Result.isFailure(contracts.decodeRow(created))).toBe(true); expect(Result.isFailure(contracts.decodeCreatedRow(scalar))).toBe(true);
    for (const value of [{ ...created, groups: ["cusgroup-unread"] }, { ...created, addresses: [{}] },
      { ...created, has_account: "false" }, { ...created, deleted_at: "2026-10-22T00:00:00.000Z" }, { ...created, foreign: null }])
      expect(Result.isFailure(contracts.decodeCreatedRow(value))).toBe(true);
    const { metadata: _metadata, ...incomplete } = scalar;
    expect(Result.isFailure(contracts.decodeRow(incomplete))).toBe(true);
    expect(Result.isFailure(contracts.decodeRows([scalar, scalar]))).toBe(true);
    expect(Result.isFailure(contracts.initializeRows([]))).toBe(true);
  });
});
