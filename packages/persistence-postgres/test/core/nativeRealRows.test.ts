import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileTaxCoreDefinition } from "../../../medusa-adapter/src/modules/tax/schema";
import { coreNativeRelationalRows } from "../../src/core/nativePolicy";
import { inspectRelationalRealNormalization } from "../../src/values/relationalRows";

const target = { scopeUuid: "a3000000-0000-4000-8000-000000000001", epochUuid: "a3000000-0000-4000-8000-000000000002" };
const timestamp = "2026-01-01T00:00:00.000Z";
const row = (rate: number) => ({ id: "rate", code: "CODE", name: "Rate", tax_region_id: "region", rate });
async function policy() {
  const definition = await Effect.runPromise(compileTaxCoreDefinition(target));
  const table = definition.tables.find(table => table.localName === "tax_rate");
  const policy = table === undefined ? undefined : coreNativeRelationalRows(definition, table.name);
  if (policy === undefined) throw new Error("Missing genuine native Tax Rate policy");
  return policy;
}

describe("Core native REAL row boundaries", () => {
  it("normalizes every admitted native writer's complete row before Source storage", async () => {
    const selected = await policy();
    const normalized = Result.getOrThrow(selected.rows.normalize(row(1.0000000596046448), null, timestamp));
    expect(normalized.rate).toBe(1.0000001);
    const changed = Result.getOrThrow(selected.rows.normalize({ name: "Changed" }, normalized, timestamp));
    expect(changed.rate).toBe(1.0000001);
    expect(Result.isSuccess(selected.rows.validate(changed, "storedCorruption"))).toBe(true);
  });

  it("refuses noncanonical cold REAL documents without repairing their stored bytes", async () => {
    const selected = await policy();
    const canonical = Result.getOrThrow(selected.rows.normalize(row(0.1), null, timestamp));
    expect(selected.rows.validate({ ...canonical, rate: 1.0000000596046448 }, "storedCorruption"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
    expect(selected.rows.validate({ ...canonical, rate: -0 }, "storedCorruption"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
  });

  it("retains authentic complete submitted REAL evidence only on the issued immutable row", async () => {
    const selected = await policy(), submitted = row(1.0000000596046448);
    const normalized = Result.getOrThrow(selected.rows.normalize(submitted, null, timestamp));
    expect(inspectRelationalRealNormalization(normalized)).toEqual({ rate: submitted.rate });
    expect(Object.isFrozen(inspectRelationalRealNormalization(normalized))).toBe(true);
    expect(inspectRelationalRealNormalization(submitted)).toBeUndefined();
    const cold = { ...normalized };
    expect(Result.isSuccess(selected.rows.validate(cold, "storedCorruption"))).toBe(true);
    expect(inspectRelationalRealNormalization(cold)).toBeUndefined();
    expect(inspectRelationalRealNormalization(new Proxy(normalized, { get: () => { throw new Error("Foreign REAL evidence getter"); } }))).toBeUndefined();
    const changed = Result.getOrThrow(selected.rows.normalize({ name: "Changed" }, normalized, timestamp));
    expect(inspectRelationalRealNormalization(changed)).toEqual({ rate: 1.0000001 });
    const nullable = Result.getOrThrow(selected.rows.normalize({ ...submitted, rate: null }, null, timestamp));
    expect(inspectRelationalRealNormalization(nullable)).toEqual({ rate: null });
  });

  it.each([1e-46, 3.5e38])("refuses row conversion range %s before storage", async rate => {
    const selected = await policy();
    expect(selected.rows.normalize(row(rate), null, timestamp))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentValidation" } });
  });
});
