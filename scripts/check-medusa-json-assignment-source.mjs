// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

export const jsonAssignmentCapsule = "third_party/medusa/runtime-dependencies/mikro-orm-core-6.4.16/";
export const jsonAssignmentTarget = "packages/medusa-utils/src/dal/json-assignment.ts";
const message = "Changed pinned native JSON assignment extraction";
const envelope = "/** Selected MikroORM6.4.16 JSON assignment, Copyright(c)2018 Martin Adámek.\n * MIT notice: ../../LICENSE.mikro-orm. Frozen sources and exact extraction guard:\n * third_party/medusa/runtime-dependencies/mikro-orm-core-6.4.16.\n *\n * Inputs have passed the owning bounded JsonObject/null decoder. Only captured\n * JSON is supported: ORM PlainObject instances, custom clones and entity values\n * are outside this seam. The existing native Medusa copier establishes ordinary\n * JSON container representation before the pinned plain-object decisions and\n * supplies the equivalent JSON-only Utils.copy binding.\n */\nimport { parseStringifyIfNecessary } from \"../common/parse-stringify-if-necessary\"\n\ntype JsonRecord = Record<string, unknown>\ntype JsonInput = Readonly<JsonRecord> | null\n\n/** Algorithm-domain policy after the caller's JSON capture/decoder. Own\n * __proto__ keys are unsupported because the original foreign merge can follow\n * an inherited target object. Constructor/prototype business keys stay valid.\n * This is not a replacement JSON validator, byte/depth limit or authority. */\nexport function supportsNativeJsonObjectAssignment(input: JsonInput): boolean {\n  const active = new Set<object>()\n  const visit = (value: unknown): boolean => {\n    if (value === null || typeof value !== \"object\") return true\n    if (active.has(value) || Object.prototype.hasOwnProperty.call(value, \"__proto__\")) return false\n    const prototype = Object.getPrototypeOf(value)\n    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false\n    active.add(value)\n    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {\n      if (!(\"value\" in descriptor) || !visit(descriptor.value)) return false\n    }\n    active.delete(value)\n    return true\n  }\n  return visit(input)\n}\n\nfunction ordinaryJsonObject(input: JsonInput): JsonRecord | null {\n  const value: unknown = parseStringifyIfNecessary(input)\n  if (value === null || Utils.isObject(value)) return value\n  throw new TypeError(\"Expected captured native JSON object or null\")\n}\n\n/** Native mergeObjectProperties:true for a checked JSON column. Refusal occurs\n * before normalization or the original unsafe merge. Callers own input/stored\n * failure classification and decode the returned JSON with their DML contract. */\nexport function assignNativeJsonObject(current: JsonInput, patch: JsonInput): JsonRecord | null {\n  if (!supportsNativeJsonObjectAssignment(current) || !supportsNativeJsonObjectAssignment(patch)) {\n    throw new TypeError(\"Unsupported native JSON assignment domain\")\n  }\n  const before = ordinaryJsonObject(current), value = ordinaryJsonObject(patch)\n  if (Utils.isPlainObject(before) && Utils.isPlainObject(value)) {\n    return Utils.merge({}, before, value)\n  }\n  return value\n}\n\n";
/** @type {Array<[string,string,number]>} */
const files = [
  ["package.json", "54f22c6c0376f9a644f5880e112949aa8d483aa5e652fb0c49ac939a86360305", 1716],
  ["LICENSE", "c14ff5e5851d30b20fa7af2ba478af713587917ad1c1c92edde1fa84a82fd532", 1071],
  ["EntityAssigner.js", "0dd39b1ac1af976edd1b88f2e916fbedef61664c6bac8a5070b82aa4b37578bd", 12166],
  ["Utils.js", "6b777130a6caf302251e3cedbcf972ef43ea6b3e4aa5e0118dec09c61f68d216", 40556],
  ["clone.js", "e2577d68e738d4c9dfdd2872d290c60b9369d0910226828e973aababe019b7bb", 4883],
  ["enums.js", "e0c3c47ca06a757c631286e15871f58315276ad58c17533ac27250e17c84b615", 8245],
];
/** @param {string} text */
function emit(text) {
  const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed,
  } });
  if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(message);
  return result.outputText;
}
/** @param {string} source @param {string} name */
function method(source, name) {
  const parsed = ts.createSourceFile("Utils.js", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const classes = parsed.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "Utils");
  if (classes.length !== 1 || !ts.isClassDeclaration(classes[0])) throw new Error(message);
  const selected = classes[0].members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
  if (selected.length !== 1) throw new Error(message);
  return selected[0].getText(parsed);
}
/** Whole emitted module equality permits erased declarations/formatting only.
 * Captured JSON excludes the ORM PlainObject class and custom clone operation;
 * Object.hasOwn becomes the equivalent ES2021 hasOwnProperty.call operation;
 * selected method bodies otherwise come literally from the frozen dependency.
 * @param {string} source @param {string} target */
export function verifyNativeJsonAssignmentExtraction(source, target) {
  const plain = method(source, "isPlainObject");
  const arm = "|| value instanceof enums_1.PlainObject;";
  if (plain.split(arm).length !== 2 || !plain.includes("return (value !== null")) throw new Error(message);
  const hasOwn = "Object.hasOwn(value.constructor.prototype, 'isPrototypeOf')";
  if (plain.split(hasOwn).length !== 2) throw new Error(message);
  const selected = [method(source, "isObject"), plain.replace("return (value !== null", "return !!((value !== null").replace(arm, ");")
    .replace(hasOwn, "Object.prototype.hasOwnProperty.call(value.constructor.prototype, 'isPrototypeOf')"),
    method(source, "merge"), method(source, "_merge")];
  const copy = method(source, "copy"), binding = "return (0, clone_1.clone)(entity, respectCustomCloneMethod);";
  if (copy.split(binding).length !== 2) throw new Error(message);
  selected.push(copy.replace(binding, "return parseStringifyIfNecessary(entity);"));
  const expected = envelope + "class Utils {\n" + selected.join("\n\n") + "\n}\n";
  if (emit(expected) !== emit(target)) throw new Error(message);
}
/** @param {string} root @param {Record<string,string>} overrides */
export function verifyNativeJsonAssignment(root, overrides = {}) {
  /** @param {string} file */
  const bytes = file => Object.hasOwn(overrides, file) ? Buffer.from(overrides[file]) : readFileSync(path.join(root, file));
  /** @param {string} file */
  const text = file => bytes(file).toString("utf8");
  for (const [file, hash, size] of files) {
    const value = bytes(jsonAssignmentCapsule + file);
    if (value.length !== size || createHash("sha256").update(value).digest("hex") !== hash) throw new Error(message);
  }
  if (createHash("sha256").update(bytes(jsonAssignmentCapsule + "SOURCE.json")).digest("hex") !== "f668a88b2872032183c0ec85d72483d7ad78621f8a6f14b41c6f5796d815b93e") throw new Error(message);
  /** @type {{package:string,version:string,license:string,medusaCommit:string,medusaLockfile:string,medusaLockfileSha256:string,packageIntegrity:string,files:Array<{path:string,sha256:string,bytes:number}>}} */
  const provenance = JSON.parse(text(jsonAssignmentCapsule + "SOURCE.json"));
  if (provenance.package !== "@mikro-orm/core" || provenance.version !== "6.4.16" || provenance.license !== "MIT"
      || provenance.medusaCommit !== "48d5cc675e4e8bc821e22c20c88a751acc66fb5f"
      || provenance.medusaLockfile !== "third_party/medusa/upstream/pnpm-lock.yaml"
      || provenance.medusaLockfileSha256 !== "2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe"
      || provenance.packageIntegrity !== "sha512-BW/My1VlI0R25Eojdh0UiET8J+mEruThksGVfllEnjJQ0uwGs3mm/TbMclv0g+d7Qp4+mpzDQU4+lIo8okHYsw=="
      || provenance.files.length !== files.length) throw new Error(message);
  for (const [file, hash, size] of files) {
    const matching = provenance.files.filter(item => item.path === file && item.sha256 === hash && item.bytes === size);
    if (matching.length !== 1) throw new Error(message);
  }
  if (createHash("sha256").update(bytes(provenance.medusaLockfile)).digest("hex") !== provenance.medusaLockfileSha256
      || !bytes("packages/medusa-utils/LICENSE.mikro-orm").equals(bytes(jsonAssignmentCapsule + "LICENSE"))) throw new Error(message);
  verifyNativeJsonAssignmentExtraction(text(jsonAssignmentCapsule + "Utils.js"), text(jsonAssignmentTarget));
}
