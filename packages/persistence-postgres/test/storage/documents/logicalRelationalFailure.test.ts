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
    keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [{ constraintId: "check", kind: "textSet", columnId: "id", values: ["row"], origin }], relationships: [] },
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


it("copies CHECK identities and unique ordered fields/values while preserving exact first issuance", () => {
  const sourceConstraint = table.constraints[0];
  if (sourceConstraint === undefined) throw new Error("Missing CHECK identity");
  const constraint = { ...sourceConstraint.identity };
  const check = new Error("check");
  retainLogicalRelationalFailure(check, { origin: "row", kind: "check", table: table.identity, column: "id", constraint });
  const checked = inspectLogicalRelationalFailure(check);
  Object.defineProperty(constraint, "constraintId", { value: "changed" });
  expect(checked).toMatchObject({ kind: "check", constraint: { constraintId: "check" } });
  if (checked?.kind !== "check") throw new Error("Missing CHECK evidence");
  expect(Object.isFrozen(checked.constraint)).toBe(true);
  const primary = table.keys[0];
  if (primary === undefined) throw new Error("Missing primary key");
  const columns = ["id"], values = ["row"], key = { ...primary.identity };
  const unique = Object.freeze(new Error("unique"));
  let touched = false;
  const foreign = Object.freeze({ get id() { touched = true; return "row"; } });
  retainLogicalRelationalFailure(unique, { origin: "input", kind: "unique", table: table.identity,
    key: { kind: "primary", identity: key }, columns, values, candidate: foreign });
  const retained = inspectLogicalRelationalFailure(unique);
  columns[0] = "changed"; values[0] = "changed";
  expect(retained).toEqual({ origin: "input", kind: "unique", table: table.identity,
    key: { kind: "primary", identity: primary.identity }, columns: ["id"], values: ["row"] });
  expect(touched).toBe(false);
  if (retained?.kind !== "unique") throw new Error("Missing unique evidence");
  expect(Object.isFrozen(retained.key)).toBe(true);
  expect(Object.isFrozen(retained.columns)).toBe(true); expect(Object.isFrozen(retained.values)).toBe(true);
  retainLogicalRelationalFailure(unique, evidence);
  expect(inspectLogicalRelationalFailure(unique)).toBe(retained);
  for (const copy of [{ ...unique }, { cause: unique }, JSON.parse(JSON.stringify(unique))])
    expect(inspectLogicalRelationalFailure(copy)).toBeUndefined();
});


it("does not inspect public cause getters on unissued errors", () => {
  let touched = false;
  const foreign = Object.freeze({ get cause() { touched = true; throw new Error("not inspected"); } });
  expect(inspectLogicalRelationalFailure(foreign)).toBeUndefined();
  expect(touched).toBe(false);
});
