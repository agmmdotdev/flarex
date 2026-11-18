// @ts-check
import { createHash } from "node:crypto";
import ts from "@typescript/typescript6";

const failure = "Changed approved native PriceList Price update compensation";
/** These pins describe the explicitly approved private-fork extension, not an
 * upstream parity claim. The enclosing promotion verifier still authenticates
 * every unrelated Pricing member against its unchanged native owners. */
const memberPins = new Map([
  ["snapshotPriceListPricesForUpdate", "6e79f4e66f4c232cde4c9afdc6f49b38cc3f0a540f46af08d8e875aa4dc62e64"],
  ["restorePriceListPrices", "6a846d758c34ecf83bd8af02d495a5b55379e88c2104f62eb92095f95c74d36e"],
  ["restorePriceListPrices_", "f1a9f71de7de15166087e3474ef835f824575b42ed6106b019e1bc58193f832f"],
]);
const imports = ["PriceListPriceSnapshotPrice", "PriceListPriceSnapshotRule",
  "PriceListPriceUpdateCompensation", "PriceListPriceUpdateSnapshot"];
/** @param {string} text */
const normalized = text => text.replaceAll("\r\n", "\n").trim();
/** @param {string} text */
const digest = text => createHash("sha256").update(normalized(text)).digest("hex");

/** Authenticate only the three exact approved members and four type imports,
 * then reverse that addition for the existing whole-Pricing promotion proof.
 * No other member, decorator, initializer or import is ignored.
 * @param {string} pricing @returns {string} */
export function stripNativePriceListPriceUpdatePricingExtension(pricing) {
  const source = ts.createSourceFile("pricing-module.ts", pricing, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const owners = source.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "PricingModuleService");
  const owner = owners[0];
  if (owners.length !== 1 || owner === undefined || !ts.isClassDeclaration(owner)) throw new Error(failure);
  /** @type {{start:number,end:number}[]} */ const removals = [];
  for (const [name, pin] of memberPins) {
    const matches = owner.members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
    const member = matches[0];
    if (matches.length !== 1 || member === undefined || digest(member.getText(source)) !== pin) throw new Error(failure + ": " + name);
    removals.push({ start: member.getFullStart(), end: member.getEnd() });
  }
  let reversed = pricing;
  for (const removal of removals.sort((a, b) => b.start - a.start)) reversed = reversed.slice(0, removal.start) + reversed.slice(removal.end);
  reversed = reversed.replaceAll("\r\n", "\n");
  for (const name of imports) {
    const expected = "  " + name + ",\n";
    const declarations = source.statements.filter(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@medusajs/framework/types" && node.importClause?.isTypeOnly &&
      node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(specifier => specifier.name.text === name && specifier.propertyName === undefined));
    if (declarations.length !== 1 || reversed.split(expected).length !== 2) throw new Error(failure + ": type import " + name);
    reversed = reversed.replace(expected, "");
  }
  return reversed;
}

/** Complete typed callback/type/export programs are pinned, including their
 * declarations and actual runtime code. Formatting edits require deliberate
 * review of this private-fork contract rather than relaxing the proof.
 * @param {{pricing:string,step:string,workflow:string,types:string,index:string}} sources */
export function verifyNativePriceListPriceUpdate(sources) {
  stripNativePriceListPriceUpdatePricingExtension(sources.pricing);
  const pins = {
    step: "8d70828094d8acdd5a55ea6c7c61b3f9850c1a8065dfa8125ee555ac3d2394e4",
    workflow: "3d02071c0d894f98de4bde7ea4fc531e68c7196f251163e46516072c94c43227",
    types: "4192885e54d2dbd2497fbdfe53acebe89a53c97539c51429abee22f43cf85377",
    index: "93aa508c9cc895db0279873bd62c84de9c4589cf80b5ee9194655af9a96e1685",
  };
  for (const key of /** @type {const} */ (["step", "workflow", "types", "index"]))
    if (digest(sources[key]) !== pins[key]) throw new Error(failure + ": " + key);
}
