import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeCurrencyRead, currencyUpdateRows } from "../src/currency-input";
import { currencyKeys } from "../src/currency-result";
import { decodeProductRead, decodeProductFindConfig, decodeProductCreateInput } from "../src/product-service-input";
import { decodeProductProjection, decodeProductCount } from "../src/product-value-profile";
import { decodeLocalEventOptions, decodeLocalEventBatch } from "../src/module-event-input";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

const outcome = <A>(result: Result.Result<A, CommerceTransactionError>) => Result.match(result, {
  onSuccess: value => ({ value }), onFailure: error => ({ reason: error.reason }),
});

describe("adapter structural boundaries", () => {
  it("preserves read envelopes without prematurely interpreting Medusa filters", () => {
    expect(outcome(decodeCurrencyRead({ filters: null, config: { select: ["code"] } }))).toHaveProperty("value");
    expect(outcome(decodeProductRead({ id: "p", config: null }))).toHaveProperty("value");
    expect(outcome(decodeProductRead({ code: "p" }))).toEqual({ reason: "invalidInput" });
    expect(outcome(decodeCurrencyRead({ code: 1 }))).toEqual({ reason: "invalidInput" });
    expect(outcome(decodeProductFindConfig({ take: 0, skip: -1 }))).toHaveProperty("value");
    expect(outcome(decodeProductFindConfig({ take: 1.5 }))).toEqual({ reason: "unsupportedProfile" });
    expect(outcome(decodeProductFindConfig({ extra: true }))).toEqual({ reason: "unsupportedProfile" });
  });
  it("preserves different single and bulk create validation stages", () => {
    expect(outcome(decodeProductCreateInput({}))).toEqual({ reason: "invalidInput" });
    expect(outcome(decodeProductCreateInput([{}]))).toEqual({ value: [{}] });
    expect(outcome(decodeProductCreateInput({ title: "p" }))).toEqual({ value: { title: "p" } });
  });
  it("decodes Currency update envelopes without admitting primary-key updates", () => {
    expect(outcome(currencyUpdateRows([{ entity: { code: "USD", name: "old" }, update: { name: "new" }, extra: true }]))).toEqual({ value: [{ code: "USD", name: "new" }] });
    expect(outcome(currencyUpdateRows([{ entity: { code: "usd" }, update: { code: "usd" } }]))).toEqual({ reason: "invalidInput" });
    expect(outcome(currencyUpdateRows([{ entity: { code: 1 }, update: {} }]))).toEqual({ reason: "invalidInput" });
    expect(outcome(currencyUpdateRows([{ entity: {}, update: null }]))).toEqual({ reason: "invalidInput" });
  });
  it("decodes repository results while retaining projections and key order", () => {
    expect(outcome(currencyKeys([{ code: "usd" }, { code: "eur", name: "Euro" }]))).toEqual({ value: ["usd", "eur"] });
    expect(outcome(currencyKeys([{}]))).toEqual({ reason: "storedCorruption" });
    expect(outcome(decodeProductProjection([{ title: "p", variants: [] }]))).toHaveProperty("value");
    expect(outcome(decodeProductProjection([null]))).toEqual({ reason: "storedCorruption" });
    expect(outcome(decodeProductCount({ rows: [], count: 0 }))).toHaveProperty("value");
    expect(outcome(decodeProductCount({ rows: [] }))).toEqual({ reason: "storedCorruption" });
  });
  it("admits only internal event options and array batches", () => {
    expect(outcome(decodeLocalEventOptions({ internal: true }))).toHaveProperty("value");
    for (const value of [{}, { internal: false }, { internal: true, extra: true }]) {
      expect(outcome(decodeLocalEventOptions(value))).toEqual({ reason: "unadmittedEvent" });
    }
    expect(outcome(decodeLocalEventBatch([]))).toEqual({ value: [] });
    expect(outcome(decodeLocalEventBatch({}))).toEqual({ reason: "unadmittedEvent" });
  });
});
