// @ts-check
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assignNativeJsonObject, supportsNativeJsonObjectAssignment } from "../packages/medusa-utils/src/dal/json-assignment";
import { verifyNativeJsonAssignment, jsonAssignmentCapsule } from "./check-medusa-json-assignment-source.mjs";

const root = process.cwd();
const nativeRequire = createRequire(path.join(root, "third_party/medusa/upstream/package.json"));
const nativeDirectory = path.dirname(nativeRequire.resolve("@mikro-orm/core/package.json"));
const { EntityAssigner } = nativeRequire(path.join(nativeDirectory, "entity/EntityAssigner.js"));
const { ReferenceKind } = nativeRequire(path.join(nativeDirectory, "enums.js"));
const fixtures = [
  ["nested objects, arrays and null", '{"kept":1,"nested":{"old":true},"list":[1,2]}', '{"nested":{"new":true},"list":[null,3]}'],
  ["array replaced by object", '{"value":[1,2]}', '{"value":{"new":true}}'],
  ["object replaced by array", '{"value":{"old":true}}', '{"value":[null,{"new":true}]}'],
  ["null replaced by object", '{"value":null}', '{"value":{"new":true}}'],
  ["object replaced by null", '{"value":{"old":true}}', '{"value":null}'],
  ["top level null patch", '{"kept":1}', 'null'],
  ["top level null prior", 'null', '{"new":true}'],
  ["both null", 'null', 'null'],
  ["empty patch preserves", '{"kept":1,"nested":{"old":true}}', '{}'],
  ["empty nested patch preserves", '{"nested":{"old":true}}', '{"nested":{}}'],
  ["empty prior", '{}', '{"new":true}'],
  ["own constructor string on patch", '{"kept":1}', '{"constructor":"business","new":true}'],
  ["own constructor object on patch", '{"kept":1}', '{"constructor":{"business":true},"new":true}'],
  ["own constructor null on patch", '{"kept":1}', '{"constructor":null,"new":true}'],
  ["own constructor string on prior", '{"constructor":"business","kept":1}', '{"new":true}'],
  ["own constructor object on prior", '{"constructor":{"business":true},"kept":1}', '{"new":true}'],
  ["nested own constructor", '{"nested":{"old":true}}', '{"nested":{"constructor":"business","new":true}}'],
  ["own prototype key", '{"prototype":{"old":true}}', '{"prototype":{"new":true}}'],
  ["array descendants with constructor", '{}', '{"list":[{"constructor":"business","value":{"new":true}}]}'],
  ["negative zero and false", '{"zero":-0,"kept":false}', '{"value":-0}'],
  ["nested scalar replaced by object", '{"nested":false}', '{"nested":{"new":true}}'],
];

/** @overload @param {Record<string,unknown>|null} value @returns {Record<string,unknown>|null} */
/** @overload @param {unknown} value @returns {unknown} */
/** Representation-only fixture transform; never a substitute merge algorithm.
 * @param {unknown} value @returns {unknown} */
function nullPrototype(value) {
  if (Array.isArray(value)) return value.map(nullPrototype);
  if (value === null || typeof value !== "object") return value;
  return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nullPrototype(child)])));
}

describe("portable JSON assignment against genuine pinned EntityAssigner", () => {
  it("compares own constructor JSON by content while retaining real prototype and negative-zero checks", () => {
    const left = JSON.parse('{"constructor":{"business":true},"value":-0}');
    const right = JSON.parse('{"constructor":{"business":true},"value":-0}');
    expect(left.constructor).not.toBe(right.constructor);
    assert.deepStrictEqual(left, right);
    assert.throws(() => assert.deepStrictEqual(left, { constructor: { business: false }, value: -0 }));
    assert.throws(() => assert.deepStrictEqual(left, { constructor: { business: true }, value: 0 }));
    assert.throws(() => assert.deepStrictEqual(left, Object.assign(Object.create(null), right)));
  });
  it("authenticates the actual installed foreign sources used by the differential", () => {
    verifyNativeJsonAssignment(root);
    const provenance = JSON.parse(readFileSync(path.join(root, jsonAssignmentCapsule, "SOURCE.json"), "utf8"));
    for (const entry of provenance.files) {
      expect(readFileSync(path.join(nativeDirectory, entry.installedSource)))
        .toEqual(readFileSync(path.join(root, jsonAssignmentCapsule, entry.path)));
    }
  });
  for (const representation of ["ordinary", "null-prototype"]) {
    it.each(fixtures)(`${representation}: %s`, (_name, priorText, patchText) => {
      // The native JSON entity value is ordinary JSON, independent of the
      // portable capture/storage record representation. Invoke the actual
      // original EntityAssigner, never a reproduced expected-value algorithm.
      const entity = { data: JSON.parse(priorText) };
      EntityAssigner.assignProperty(entity, "data", { data: {
        kind: ReferenceKind.SCALAR, runtimeType: "unknown", nullable: true,
      } }, { data: JSON.parse(patchText) }, { mergeObjectProperties: true });
      const prior = representation === "ordinary" ? JSON.parse(priorText) : nullPrototype(JSON.parse(priorText));
      const patch = representation === "ordinary" ? JSON.parse(patchText) : nullPrototype(JSON.parse(patchText));
      const before = [JSON.stringify(prior), JSON.stringify(patch)];
      expect(supportsNativeJsonObjectAssignment(prior)).toBe(true);
      expect(supportsNativeJsonObjectAssignment(patch)).toBe(true);
      const result = assignNativeJsonObject(prior, patch);
      // Vitest5 typeEquality compares the .constructor business property's
      // identity. Node's strict comparator checks actual prototypes and all
      // own JSON data, including nested constructor objects and negative zero.
      assert.deepStrictEqual(result, entity.data);
      if (result !== null) expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect([JSON.stringify(prior), JSON.stringify(patch)]).toEqual(before);
      expect(result).not.toBe(prior === null ? undefined : prior);
      expect(result).not.toBe(patch === null ? undefined : patch);
    });
  }
  it.each([
    '{"__proto__":{"unsafe":true}}',
    '{"nested":{"__proto__":{"unsafe":true}}}',
    '{"list":[{"__proto__":"business"}]}',
    '{"constructor":{"__proto__":{"unsafe":true}}}',
  ])("refuses unsupported own keys before original unsafe merge: %s", text => {
    const value = JSON.parse(text), before = Object.getOwnPropertyDescriptors(Object.prototype);
    expect(supportsNativeJsonObjectAssignment(value)).toBe(false);
    expect(() => assignNativeJsonObject({}, value)).toThrow("Unsupported native JSON assignment domain");
    expect(() => assignNativeJsonObject(value, {})).toThrow("Unsupported native JSON assignment domain");
    expect(supportsNativeJsonObjectAssignment(nullPrototype(value))).toBe(false);
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
    // Deliberately never call the unsafe original method with these values in
    // this shared test realm; the preserved isolated native witness owns that.
  });
  it("refuses accessors, cycles and ORM/custom instances before invoking normalization", () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, "data", { enumerable: true, get() { invoked = true; throw new Error("getter called"); } });
    const cycle = {}; Object.defineProperty(cycle, "self", { value: cycle, enumerable: true });
    for (const value of [accessor, cycle, new Date(), Object.create({ business: true })]) {
      expect(supportsNativeJsonObjectAssignment(value)).toBe(false);
      expect(() => assignNativeJsonObject({}, value)).toThrow("Unsupported native JSON assignment domain");
    }
    expect(invoked).toBe(false);
  });
});
