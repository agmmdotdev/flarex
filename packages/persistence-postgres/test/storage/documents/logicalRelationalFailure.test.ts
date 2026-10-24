import { expect, it } from "vitest";
import { Result } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJsonObject } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../../../src/values/privateJsonData";
import { inspectLogicalRelationalFailure, retainLogicalRelationalFailure } from "../../../src/storage/documents/logicalDocuments/relationalFailure";
import { logicalCommerceError } from "../../../src/frameworks/commerceTransaction/model";
import { projectCommerceRequestFailure } from "../../../src/frameworks/commerceTransaction/request";

const origin = { kind: "synthetic", sourceId: "relational-failure-registry" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "system", lineageId: origin.sourceId, capabilities: [], tables: [
  { tableId: "entry", origin, columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin }],
    keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] },
] }));
const table = schema.tables[0];
if (table === undefined) throw new Error("Missing registry table identity");
const evidence = { origin: "row", kind: "missing", table: table.identity, column: "id" } as const;

it("retains exact frozen failure identity and immutable captured candidate through Commerce projection", () => {
  const input = { metadata: { selected: true }, values: [1, 2] };
  const captured = Result.getOrThrow(capturePrivateJsonData(input, 4096, logicalCommerceError));
  if (!isJsonObject(captured.value)) throw new Error("Expected object candidate");
  const failure = Object.freeze(logicalCommerceError("documentInvalid"));
  retainLogicalRelationalFailure(failure, { ...evidence, candidate: captured.value });
  input.metadata.selected = false; input.values[0] = 9;
  expect(projectCommerceRequestFailure(failure)).toBe(failure);
  const retained = inspectLogicalRelationalFailure(failure);
  expect(retained).toMatchObject({ ...evidence, candidate: { metadata: { selected: true }, values: [1, 2] } });
  expect(Object.isFrozen(retained)).toBe(true); expect(Object.isFrozen(retained?.table)).toBe(true);
  expect(Object.isFrozen(retained?.candidate?.metadata)).toBe(true); expect(Object.isFrozen(retained?.candidate?.values)).toBe(true);
  expect(failure.reason).toBe("invalidInput"); expect(failure.cause).toBeUndefined();
  for (const copy of [{ ...failure }, { cause: failure }, JSON.parse(JSON.stringify(failure)), new Error("documentInvalid")])
    expect(inspectLogicalRelationalFailure(copy)).toBeUndefined();
});

it("omits unowned candidates without recapturing or inspecting their members", () => {
  let read = false;
  const candidate = Object.freeze({ get id() { read = true; return null; } });
  const failure = new Error("missing");
  retainLogicalRelationalFailure(failure, { ...evidence, candidate });
  expect(inspectLogicalRelationalFailure(failure)).toEqual(evidence);
  expect(read).toBe(false);
});

it("retains the first issuance when the same error identity is reused", () => {
  const failure = new Error("reused");
  retainLogicalRelationalFailure(failure, evidence);
  const original = inspectLogicalRelationalFailure(failure);
  retainLogicalRelationalFailure(failure, { ...evidence, origin: "input", kind: "null", column: "later" });
  expect(inspectLogicalRelationalFailure(failure)).toBe(original);
  expect(original).toEqual(evidence);
});

it("does not issue provenance for primitive errors", () => {
  for (const failure of [undefined, null, false, 1, "documentInvalid"]) {
    expect(() => retainLogicalRelationalFailure(failure, evidence)).not.toThrow();
    expect(inspectLogicalRelationalFailure(failure)).toBeUndefined();
  }
});
