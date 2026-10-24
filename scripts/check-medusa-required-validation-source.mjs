// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

export const requiredValidationCapsule = "third_party/medusa/runtime-dependencies/mikro-orm-core-6.4.16-required-validation/";
export const requiredValidationTarget = "packages/medusa-utils/src/dal/required-validation.ts";
const failure = "Changed pinned native required-property presentation extraction";
/** @type {Array<[string,string,number]>} */
const files = [
  ["package.json", "54f22c6c0376f9a644f5880e112949aa8d483aa5e652fb0c49ac939a86360305", 1716],
  ["LICENSE", "c14ff5e5851d30b20fa7af2ba478af713587917ad1c1c92edde1fa84a82fd532", 1071],
  ["errors.js", "4d20e4d886aeba4907c9371e61dbaca69050c708ada716a9f5233553cc45aa83", 14263],
  ["errors.d.ts", "06460d8c49d0726b1b43ca289df53753600425c5b12d4a60824ca935c71996f1", 5708],
  ["EntityValidator.js", "33d430655056fe5a0821aaaaa162f84c36c07fc45b40592642bf1f003340d286", 6164],
];
/** Syntax-only emission; semantic typechecks use the separately selected Rust
 * compiler. @param {string} text */
function emit(text) {
  const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    removeComments: true, newLine: ts.NewLineKind.LineFeed,
  } });
  if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure);
  return result.outputText;
}

/** Only the approved first line is extracted. No ORM constructor, entity
 * inspector, validation loop or broader ORM surface is copied into runtime.
 * @param {string} original @param {string} target */
export function verifyNativeRequiredValidationExtraction(original, target) {
  const parsed = ts.createSourceFile("errors.js", original, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const owners = parsed.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "ValidationError");
  if (owners.length !== 1 || !ts.isClassDeclaration(owners[0])) throw new Error(failure);
  const selected = owners[0].members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "propertyRequired");
  if (selected.length !== 1) throw new Error(failure);
  const expectedMethod = 'static propertyRequired(entity, property) {\nconst entityName = entity.__meta.className;\nreturn new ValidationError(`Value for ${entityName}.${property.name} is required, \'${entity[property.name]}\' found\\nentity: ${(0, node_util_1.inspect)(entity)}`, entity);\n}';
  if (emit('class ValidationError {' + selected[0].getText(parsed) + '}') !== emit('class ValidationError {' + expectedMethod + '}')) throw new Error(failure);
  const prefix = 'Value for ${entityName}.${property.name} is required, \'${entity[property.name]}\' found';
  if (selected[0].getText(parsed).split(prefix).length !== 2) throw new Error(failure);
  const message = prefix.replace('${property.name}', '${propertyName}').replace('${entity[property.name]}', '${value}');
  const expected = 'export const formatRequiredPropertyMessage = (entityName: string, propertyName: string, value: null | undefined): string => `' + message + '`\n';
  if (emit(expected) !== emit(target)) throw new Error(failure);
}

/** @param {string} root @param {Record<string,string>} overrides */
export function verifyNativeRequiredValidationSource(root, overrides = {}) {
  /** @param {string} file */
  const bytes = file => Object.hasOwn(overrides, file) ? Buffer.from(overrides[file]) : readFileSync(path.join(root, file));
  for (const [file, hash, size] of files) {
    const value = bytes(requiredValidationCapsule + file);
    if (value.length !== size || createHash("sha256").update(value).digest("hex") !== hash) throw new Error(failure);
  }
  const provenanceBytes = bytes(requiredValidationCapsule + "SOURCE.json");
  if (createHash("sha256").update(provenanceBytes).digest("hex") !== "39c5b98f6327dafba9fdbc39552131fe685407b55d7a604152670334a7206d13") throw new Error(failure);
  /** @type {{package:string,version:string,license:string,medusaCommit:string,medusaLockfile:string,medusaLockfileSha256:string,packageIntegrity:string,files:Array<{path:string,sha256:string,bytes:number}>}} */
  const provenance = JSON.parse(provenanceBytes.toString("utf8"));
  if (provenance.package !== "@mikro-orm/core" || provenance.version !== "6.4.16" || provenance.license !== "MIT"
    || provenance.medusaCommit !== "48d5cc675e4e8bc821e22c20c88a751acc66fb5f"
    || provenance.medusaLockfile !== "third_party/medusa/upstream/pnpm-lock.yaml"
    || provenance.medusaLockfileSha256 !== "2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe"
    || provenance.packageIntegrity !== "sha512-BW/My1VlI0R25Eojdh0UiET8J+mEruThksGVfllEnjJQ0uwGs3mm/TbMclv0g+d7Qp4+mpzDQU4+lIo8okHYsw=="
    || provenance.files.length !== files.length) throw new Error(failure);
  for (const [file, hash, size] of files) {
    if (provenance.files.filter(item => item.path === file && item.sha256 === hash && item.bytes === size).length !== 1) throw new Error(failure);
  }
  if (createHash("sha256").update(bytes(provenance.medusaLockfile)).digest("hex") !== provenance.medusaLockfileSha256
    || !bytes("packages/medusa-utils/LICENSE.mikro-orm").equals(bytes(requiredValidationCapsule + "LICENSE"))) throw new Error(failure);
  verifyNativeRequiredValidationExtraction(bytes(requiredValidationCapsule + "errors.js").toString("utf8"), bytes(requiredValidationTarget).toString("utf8"));
}
