import { describe, expect, it } from "vitest";
import { Effect, Exit, Result } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureApiKeyMetadata } from "../src/modules/api-key/schema";
import { compileApiKeyContracts } from "../src/modules/api-key/contracts";

const native = () => ({ id: "apk_contract", token: "pk_" + "a".repeat(64), salt: undefined,
  redacted: "pk_aaa***aaa", title: "Storefront", type: "publishable", created_by: "owner",
  last_used_at: null, revoked_by: null, revoked_at: null, deleted_at: null,
  created_at: "2026-10-23T00:00:00.000Z", updated_at: "2026-10-23T00:00:00.000Z" });
const contracts = Effect.gen(function* () {
  const metadata = yield* captureApiKeyMetadata(), table = metadata.frame.tables[0];
  if (table === undefined) throw new Error("Missing native API Key metadata");
  return yield* Effect.fromResult(compileApiKeyContracts(table));
});

describe("checked native API Key public results", () => {
  it("validates the complete native result while omitting exactly its undefined salt", async () => {
    const selected = await Effect.runPromise(contracts), value = native();
    const output = await Effect.runPromise(selected.captureOutput([value], defaultCommerceResources));
    const { salt: _salt, ...expected } = value;
    expect(output).toEqual([expected]);
    expect(Object.hasOwn(output[0] ?? {}, "salt")).toBe(false);
    expect(Object.hasOwn(value, "salt")).toBe(true);
    expect(Result.isSuccess(selected.output(output))).toBe(true);
  });

  it("refuses exposed salt, missing native fields, extra fields and wrong token/type", async () => {
    const selected = await Effect.runPromise(contracts), { updated_at: _updatedAt, ...missing } = native();
    for (const value of [{ ...native(), salt: "leaked" }, missing, { ...native(), injected: true }, { ...native(), injected: undefined },
      { ...native(), token: "pk_invalid" }, { ...native(), type: "secret" }])
      expect(Exit.isFailure(await Effect.runPromiseExit(selected.captureOutput([value], defaultCommerceResources)))).toBe(true);
  });

  it("refuses getters on returned records without evaluating them", async () => {
    const selected = await Effect.runPromise(contracts);
    let evaluated = false;
    const value = Object.defineProperty(native(), "title", { enumerable: true, get() { evaluated = true; return "poisoned"; } });
    expect(Exit.isFailure(await Effect.runPromiseExit(selected.captureOutput([value], defaultCommerceResources)))).toBe(true);
    expect(evaluated).toBe(false);
  });

  it("refuses getters on the native array without evaluating them", async () => {
    const selected = await Effect.runPromise(contracts);
    let evaluated = false;
    const values = Object.defineProperty([native()], "0", { enumerable: true, get() { evaluated = true; return native(); } });
    expect(Exit.isFailure(await Effect.runPromiseExit(selected.captureOutput(values, defaultCommerceResources)))).toBe(true);
    expect(evaluated).toBe(false);
  });

  it("captures native selected preimages without admitting arbitrary undefined omissions", async () => {
    const selected = await Effect.runPromise(contracts);
    expect(await Effect.runPromise(selected.capturePreimages([{ id: "apk_contract", title: "Before", token: undefined }], defaultCommerceResources)))
      .toEqual([{ id: "apk_contract", title: "Before" }]);
    for (const value of [{ id: "apk_contract", title: 1 }, { title: "Missing ID" },
      { id: "apk_contract", injected: undefined }, { id: "apk_contract", salt: "" }])
      expect(Exit.isFailure(await Effect.runPromiseExit(selected.capturePreimages([value], defaultCommerceResources)))).toBe(true);
    let evaluated = false;
    const values = Object.defineProperty([], "0", { enumerable: true, get() { evaluated = true; return { id: "apk_contract" }; } });
    expect(Exit.isFailure(await Effect.runPromiseExit(selected.capturePreimages(values, defaultCommerceResources)))).toBe(true);
    expect(evaluated).toBe(false);
  });

  it("validates the complete native upsert result before discarding its ignored compensation return", async () => {
    const selected = await Effect.runPromise(contracts), stored = { ...native(), salt: "" };
    expect(await Effect.runPromise(selected.captureStored([stored], defaultCommerceResources))).toBeUndefined();
    for (const value of [native(), { ...stored, salt: "secret" }, { ...stored, extra: undefined }, { ...stored, type: "secret" }])
      expect(Exit.isFailure(await Effect.runPromiseExit(selected.captureStored([value], defaultCommerceResources)))).toBe(true);
  });
});
