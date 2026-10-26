// @ts-check
import ts from "@typescript/typescript6";

const failure = "Changed native Query key validation extraction";
export const queryKeySource = "third_party/medusa/upstream/packages/core/orchestration/src/joiner/remote-joiner.ts";
export const queryKeyTarget = "packages/medusa-orchestration/src/joiner-key-validation.ts";
/** @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyQueryKeySelection(files) {
  const selected = files.filter(file => file.target === queryKeyTarget);
  if (selected.length !== 1 || selected[0]?.source !== queryKeySource || selected[0]?.classification !== "selectedExportFacade")
    throw new Error(failure + ": exact native source identity");
}
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** @param {string} text */
const parse = text => ts.createSourceFile("query.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
/** @param {string} text */
function forms(text) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
  } });
  if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure + ": syntax");
  return [printer.printFile(parse(text)), printer.printFile(parse(emitted.outputText))];
}
/** @param {string} original @param {string} actual */
export function verifyQueryKeySource(original, actual) {
  const source = parse(original);
  const owner = source.statements.filter(ts.isClassDeclaration).find(node => node.name?.text === "RemoteJoiner");
  const method = owner?.members.filter(ts.isMethodDeclaration).find(node => node.name.getText(source) === "checkIfKeysExist");
  if (method?.body === undefined) throw new Error(failure + ": key method");
  /** @type {ts.IfStatement[]} */
  const primary = [];
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source) === "options?.throwIfKeyNotFound") primary.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (primary.length !== 1 || primary[0] === undefined) throw new Error(failure + ": primary check");
  const expected = `import type { JoinerRelationship, ModuleJoinerConfig, RemoteQueryFunction } from "@medusajs/types"
import { isDefined } from "@medusajs/utils/common/is-defined"
import { MedusaError } from "@medusajs/utils/common/errors"
type KeyService = Required<Pick<ModuleJoinerConfig, "serviceName" | "primaryKeys">> & Pick<ModuleJoinerConfig, "args"> & { readonly entity?: string }
type KeyOptions = Pick<NonNullable<Parameters<RemoteQueryFunction["graph"]>[1]>, "throwIfKeyNotFound" | "throwIfRelationNotFound">
export function validateNativeQueryPrimaryKey(serviceConfig: KeyService,
  primaryKeyArg: { readonly name: string; readonly value: unknown } | undefined, options?: KeyOptions) {
  ${primary[0].getText(source)}
}
export function validateNativeQueryKeys(params: {
  readonly uniqueIds: readonly unknown[] | undefined
  readonly resData: readonly Record<string, unknown>[]
  readonly expand: { readonly serviceConfig: KeyService }
  readonly pkField: string
  readonly relationship?: Pick<JoinerRelationship, "serviceName">
  readonly options?: KeyOptions
}) ${method.body.getText(source)}`;
  const left = forms(expected), right = forms(actual);
  if (left[0] !== right[0] || left[1] !== right[1]) throw new Error(failure);
}
