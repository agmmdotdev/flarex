import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJsonObject } from "flarex-protocol/json";
import { prepareLogicalRelationalRows, prepareLogicalRelationalRowValues, prepareLogicalRelationalTableMechanics,
  bindPreparedLogicalRelationalRows } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { inspectLogicalRelationalFailure } from "../../../src/storage/documents/logicalDocuments/relationalFailure";
import { capturePrivateJsonData } from "../../../src/values/privateJsonData";
import { logicalCommerceError } from "../../../src/frameworks/commerceTransaction/model";
import { projectCommerceRequestFailure } from "../../../src/frameworks/commerceTransaction/request";

const timestamp = "2026-10-24T00:00:00.000Z";
function fixture(type: "real" | "doublePrecision") {
  const origin = { kind: "synthetic", sourceId: "required-column-" + type };
  const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "system", lineageId: origin.sourceId, capabilities: [], tables: [
    { tableId: "entry", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "code", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "amount", type, nullable: true, default: { kind: "none" }, origin },
      { columnId: "label", type: "text", nullable: false, default: { kind: "textLiteral", value: "default" }, origin },
      { columnId: "created_at", type: "timestamptz", nullable: false, default: { kind: "currentTimestamp" }, origin },
    ], keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] },
  ] }));
  const table = schema.tables[0]; if (table === undefined) throw new Error("Missing required-column table");
  const mechanics = prepareLogicalRelationalTableMechanics(table, schema.capabilities);
  const policy = Result.getOrThrow(bindPreparedLogicalRelationalRows(mechanics, logicalCommerceError));
  return { table, schema, mechanics, policy };
}

describe("required-column evidence at existing logical row rejection owners", () => {
  it.each(["real", "doublePrecision"] as const)("retains missing fields from the actual %s candidate after defaults", type => {
    const { table, policy } = fixture(type);
    const rejected = policy.normalize({ id: "row", amount: 1.0000000596046448 }, null, timestamp);
    if (Result.isSuccess(rejected)) throw new Error("Missing required code must fail");
    expect(rejected.failure).toMatchObject({ reason: "invalidInput", cause: { reason: "missingColumn", column: "code" } });
    const evidence = inspectLogicalRelationalFailure(rejected.failure);
    expect(evidence).toEqual({ origin: "row", kind: "missing", table: table.identity, column: "code",
      candidate: { id: "row", amount: 1.0000000596046448, label: "default", created_at: timestamp } });
    expect(Object.hasOwn(evidence?.candidate ?? {}, "code")).toBe(false);
    expect(projectCommerceRequestFailure(rejected.failure)).toBe(rejected.failure);
    expect(inspectLogicalRelationalFailure({ cause: rejected.failure })).toBeUndefined();
  });

  it("retains explicit nonnullable NULL at supplied-input rejection before adding defaults", () => {
    const { table, policy } = fixture("doublePrecision"), input = { id: "row", code: null };
    const captured = Result.getOrThrow(capturePrivateJsonData(input, 4096, logicalCommerceError));
    if (!isJsonObject(captured.value)) throw new Error("Expected captured supplied row");
    const rejected = policy.validateInput(captured.value);
    if (Result.isSuccess(rejected)) throw new Error("Required NULL must fail");
    expect(rejected.failure).toMatchObject({ reason: "invalidInput" });
    expect(rejected.failure.cause).toBeUndefined();
    expect(inspectLogicalRelationalFailure(rejected.failure)).toEqual({ origin: "input", kind: "null", table: table.identity,
      column: "code", candidate: { id: "row", code: null } });
    expect(Object.hasOwn(inspectLogicalRelationalFailure(rejected.failure)?.candidate ?? {}, "label")).toBe(false);
  });

  it("records the actual column for unowned direct input without inventing a candidate", () => {
    const { table, schema } = fixture("doublePrecision");
    const direct = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities, logicalCommerceError));
    const rejected = direct.validateInput(Object.freeze({ id: "row", code: null }));
    if (Result.isSuccess(rejected)) throw new Error("Required NULL must fail");
    expect(inspectLogicalRelationalFailure(rejected.failure)).toEqual({ origin: "input", kind: "null", table: table.identity, column: "code" });
  });

  it("preserves successful defaults and nullable NULL without changing accepted rows", () => {
    const { policy } = fixture("doublePrecision");
    expect(Result.getOrThrow(policy.normalize({ id: "row", code: "valid", amount: null }, null, timestamp)))
      .toEqual({ id: "row", code: "valid", amount: null, label: "default", created_at: timestamp });
    expect(policy.validateInput({ id: "row", code: "valid", amount: null })).toMatchObject({ _tag: "Success" });
  });

  it("does not label unrelated type, unknown-field or stored-corruption failures as required-column evidence", () => {
    const { table, schema, policy } = fixture("doublePrecision");
    for (const input of [{ id: "row", code: 1 }, { id: "row", code: "valid", unknown: null }]) {
      const rejected = policy.validateInput(input);
      if (Result.isSuccess(rejected)) throw new Error("Malformed row must fail");
      expect(inspectLogicalRelationalFailure(rejected.failure)).toBeUndefined();
    }
    const rejected = prepareLogicalRelationalRowValues(table, schema.capabilities, logicalCommerceError)({ id: "row" }, "storedCorruption");
    if (Result.isSuccess(rejected)) throw new Error("Incomplete stored row must fail");
    expect(rejected.failure.reason).toBe("storedCorruption");
    expect(inspectLogicalRelationalFailure(rejected.failure)).toBeUndefined();
  });
});
