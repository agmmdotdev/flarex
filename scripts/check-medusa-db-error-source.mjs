// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

export const databaseErrorSource = "third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/db-error-mapper.ts";
export const databaseErrorMapperTarget = "packages/medusa-utils/src/dal/mikro-orm/db-error-mapper.ts";
export const databaseConstraintTarget = "packages/medusa-utils/src/dal/database-constraint.ts";
const failure = "Changed native database constraint presentation extraction";
const parserHeader = "const getConstraintInfo = (err: any) => {";
const mapperImport = 'import { MedusaError, upperCaseFirst } from "../../common"';
const helperImport = '\nimport {\n  formatForeignKeyConstraintMessage,\n  formatUniqueConstraintMessage,\n  parseDatabaseConstraintInfo,\n} from "../database-constraint"';
const sharedTupleParsing = "const selectConstraintTuples = (value: string): readonly string[] =>\n  value.match(/\\([^\\(]*\\)/g) || []\n\nconst splitConstraintValues = (value: string): string[] =>\n  value.split(\",\").map((value) => value.trim())\n\nconst parseConstraintTupleValues = (tuple: string): string[] =>\n  splitConstraintValues(tuple.substring(1, tuple.length - 1))\n\n";
// Explicit single-column value-tuple framing; never fabricates native detail.
const scalarFormatter = "\nexport const formatScalarForeignKeyConstraintMessage = (column: string, value: string): string => {\n  const [tuple] = selectConstraintTuples(\"(\" + value + \")\")\n  return formatForeignKeyConstraintMessage({\n    keys: [column],\n    values: tuple === undefined ? [] : parseConstraintTupleValues(tuple),\n  })\n}\n";

const textUniqueFormatter = "\nexport const formatTextUniqueConstraintMessage = (table: string, columns: readonly string[], values: readonly string[]): string => {\n  const [tuple] = selectConstraintTuples(\"(\" + values.join(\", \") + \")\")\n  return formatUniqueConstraintMessage({\n    table,\n    keys: columns,\n    values: tuple === undefined ? [] : parseConstraintTupleValues(tuple),\n  })\n}\n";

/** Syntax-only emission authenticates the complete runtime; typechecks use the
 * separately selected Rust compiler. @param {string} text */
function emit(text) {
  const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    removeComments: true, newLine: ts.NewLineKind.LineFeed,
  } });
  if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure);
  return result.outputText;
}

/** Keep every native branch and runtime statement. Native tuple parsing shares
 * its split/trim leaf with the separately named bounded scalar extension.
 * @param {string} original @param {string} mapper @param {string} helper */
export function verifyNativeDatabaseConstraintExtraction(original, mapper, helper) {
  const source = original.replaceAll("\r\n", "\n");
  if (source.split(parserHeader).length !== 2 || source.split(mapperImport).length !== 2) throw new Error(failure);
  const parserStart = source.indexOf(parserHeader);
  let parser = source.slice(parserStart);
  const tupleSelection = "detail.match(/\\([^\\(]*\\)/g) || []";
  if (parser.split(tupleSelection).length !== 2) throw new Error(failure);
  parser = parser.replace(tupleSelection, "selectConstraintTuples(detail)");
  const templates = source.match(/`You tried to set relationship \$\{info\?\.keys\.map\([\s\S]*?but such entity does not exist`/g) ?? [];
  if (templates.length !== 1) throw new Error(failure);
  const template = templates[0];
  const parseValueHeader = "function parseValue(value: string) {";
  const valueStart = source.indexOf(parseValueHeader), valueEnd = source.indexOf("export const dbErrorMapper");
  if (source.split(parseValueHeader).length !== 2 || valueStart < 0 || valueEnd <= valueStart) throw new Error(failure);
  const nativeParseValue = source.slice(valueStart, valueEnd).trimEnd();
  const uniqueHeader = '`${upperCaseFirst(info.table.split("_").join(" "))} with ${info.keys';
  const uniqueTail = "}, already exists.`";
  const uniqueStart = source.indexOf(uniqueHeader), uniqueEnd = source.indexOf(uniqueTail, uniqueStart);
  if (source.split(uniqueHeader).length !== 2 || source.split(uniqueTail).length !== 2 || uniqueStart < 0 || uniqueEnd < uniqueStart) throw new Error(failure);
  const uniqueTemplate = source.slice(uniqueStart, uniqueEnd + uniqueTail.length);
  for (const [name, item] of [["keys", "k"], ["values", "v"]]) {
    const originalTuple = name + ': ' + name + '\n      .substring(1, ' + name + '.length - 1)\n      .split(",")\n      .map((' + item + ') => ' + item + '.trim()),';
    if (parser.split(originalTuple).length !== 2) throw new Error(failure);
    parser = parser.replace(originalTuple, name + ': parseConstraintTupleValues(' + name + '),');
  }
  const expectedHelper = 'import { upperCaseFirst } from "../common/upper-case-first"\n\n'
    + nativeParseValue.replace("value: string", "value: string | undefined") + "\n\n"
    + sharedTupleParsing + parser.replace(parserHeader,
    "export const parseDatabaseConstraintInfo = (err: DatabaseConstraintDetails): DatabaseConstraintInfo | null => {")
    + '\nexport const formatUniqueConstraintMessage = (info: DatabaseConstraintInfo): string =>\n'
    + uniqueTemplate + '\n'
    + '\nexport const formatForeignKeyConstraintMessage = (info: Pick<DatabaseConstraintInfo, "keys" | "values"> | null): string =>\n'
    + template + "\n" + scalarFormatter + textUniqueFormatter;
  const expectedMapper = source.slice(0, parserStart)
    .replace(mapperImport, mapperImport + helperImport)
    .replace(nativeParseValue + "\n\n", "")
    .replace(uniqueTemplate, "formatUniqueConstraintMessage(info)")
    .replace(template, "formatForeignKeyConstraintMessage(info)")
    + parserHeader + "\n  return parseDatabaseConstraintInfo(err)\n}\n";
  if (emit(expectedHelper) !== emit(helper) || emit(expectedMapper) !== emit(mapper)) throw new Error(failure);
}

/** @param {string} root @param {Record<string,string>} overrides */
export function verifyNativeDatabaseConstraintSource(root, overrides = {}) {
  /** @param {string} file */
  const bytes = file => Object.hasOwn(overrides, file) ? Buffer.from(overrides[file]) : readFileSync(path.join(root, file));
  const original = bytes(databaseErrorSource);
  if (createHash("sha256").update(original).digest("hex") !== "4260cc79b93293aa6f69f81a1263f2a60efe407ee1aee5f609a4e4d30b86cd44") throw new Error(failure);
  verifyNativeDatabaseConstraintExtraction(original.toString("utf8"),
    bytes(databaseErrorMapperTarget).toString("utf8"), bytes(databaseConstraintTarget).toString("utf8"));
}
