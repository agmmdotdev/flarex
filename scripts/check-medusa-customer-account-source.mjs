// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const relatives = ["workflows/create-addresses.ts", "workflows/update-addresses.ts", "workflows/delete-addresses.ts",
  "steps/create-addresses.ts", "steps/update-addresses.ts", "steps/delete-addresses.ts", "steps/maybe-unset-default-billing-addresses.ts",
  "steps/maybe-unset-default-shipping-addresses.ts", "steps/utils/unset-address-for-create.ts", "steps/utils/unset-address-for-update.ts"];
export const customerAddressSourcePairs = Object.freeze(relatives.map(relative => Object.freeze({
  source: "third_party/medusa/upstream/packages/core/core-flows/src/customer/" + relative,
  target: "packages/medusa-core-flows/src/customer/" + relative, classification: "workflowFork",
})));
export const customerAccountLinkSourcePair = Object.freeze({
  source: "third_party/medusa/upstream/packages/modules/link-modules/src/definitions/customer-account-holder.ts",
  target: "packages/medusa-link-modules/src/definitions/customer-account-holder.ts", classification: "importRelocation",
});
export const customerAddressUpdateSourcePairs = Object.freeze([
  { source: "third_party/medusa/upstream/packages/modules/customer/src/services/customer-module.ts",
    target: "packages/medusa-customer/src/services/customer-module.ts", classification: "customerAddressUpdateFork" },
  { source: "third_party/medusa/upstream/packages/core/types/src/customer/service.ts",
    target: "packages/medusa-types/src/customer/service.ts", classification: "customerAddressUpdateFork" },
]);

/** @param {string} expected @param {string} target @param {string} targetPath */
function verifyProgram(expected, target, targetPath) {
  /** @param {string} text */
  const program = text => {
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true } });
    return [printer.printFile(ts.createSourceFile("customer.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
      printer.printFile(ts.createSourceFile("customer.js", output.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS))];
  };
  const a = program(expected), b = program(target);
  if (a[0] !== b[0] || a[1] !== b[1]) throw new Error("Changed native Customer Address source: " + targetPath);
}

/** Authenticate complete typed and emitted native programs, including the
 * approved scalar metadata preimage, exact inverse and stable default selector.
 * @param {string} source @param {string} target @param {string} targetPath */
export function verifyCustomerAddressSource(source, target, targetPath) {
  const pair = customerAddressSourcePairs.find(value => value.target === targetPath);
  if (pair === undefined) throw new Error("Unknown native Customer Address source pair");
  let expected = source.replaceAll("\r\n", "\n")
    .replaceAll('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replaceAll('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  if (targetPath.includes("/workflows/")) expected = expected.replace(/import \{([^{}]+)\} from "\.\.\/steps"/g, (_whole, /** @type {string} */ names) =>
    names.split(",").map((name) => name.trim()).filter(Boolean).map((name) => {
      const slug = name.startsWith("maybeUnsetDefault") ? name.includes("Billing") ? "maybe-unset-default-billing-addresses" : "maybe-unset-default-shipping-addresses"
        : name.startsWith("create") ? "create-addresses" : name.startsWith("update") ? "update-addresses" : "delete-addresses";
      return `import { ${name} } from "../steps/${slug}"`;
    }).join("\n"));
  if (targetPath.includes("/steps/") && !targetPath.includes("/utils/")) expected = expected
    .replace(/createStep\(\n  (\w+),/, 'createStep(\n  { name: $1, compensation: "transactionCovered" },')
    .replace('import { unsetForCreate, unsetForUpdate } from "./utils"',
      'import { unsetForCreate } from "./utils/unset-address-for-create"\nimport { unsetForUpdate } from "./utils/unset-address-for-update"');
  if (targetPath.endsWith("/steps/update-addresses.ts")) expected = expected
    .replace('getSelectsAndRelationsFromObjectArray([\n      data.update,\n    ])',
      'getSelectsAndRelationsFromObjectArray(\n      [data.update],\n      { objectFields: ["metadata"] }\n    )')
    .replace('service.updateCustomerAddresses(c.id, { ...c })',
      'Object.hasOwn(c, "metadata")\n          ? service.updateCustomerAddresses(c.id, { ...c }, undefined, {\n              metadata: "replace",\n            })\n          : service.updateCustomerAddresses(c.id, { ...c })');
  if (targetPath.endsWith("/steps/utils/unset-address-for-update.ts")) expected = expected
    .replace('  await customerService.updateCustomerAddresses(\n    { customer_id: customerIds, [field]: true },\n    { [field]: false }\n  )',
      '  const affectedAddressIds = new Set(affectedCustomers.map((address) => address.id))\n  const addressIds = customerDefaultAddresses\n    .filter((address) => !affectedAddressIds.has(address.id))\n    .map((address) => address.id)\n\n  if (addressIds.length) {\n    await customerService.updateCustomerAddresses(\n      { id: addressIds },\n      { [field]: false }\n    )\n  }')
    .replace('customerDefaultAddresses.map((address) => address.id)', 'addressIds');
  if (targetPath.endsWith("/workflows/update-addresses.ts")) expected = expected
    .replace('  AdditionalData,\n} from "@medusajs/framework/types"', '  AdditionalData,\n  ICustomerModuleService,\n} from "@medusajs/framework/types"\nimport { Modules } from "@medusajs/framework/utils/portable"')
    .replace('  createWorkflow,', '  createWorkflow,\n  createStep,\n  StepResponse,')
    .replace('export const updateCustomerAddressesWorkflowId = "update-customer-addresses"',
      'export const updateCustomerAddressesWorkflowId = "update-customer-addresses"\n\nconst selectCustomerAddressIdsStep = createStep(\n' +
      '  "select-customer-address-ids-for-update",\n  async (selector: FilterableCustomerAddressProps, { container }) => {\n' +
      '    const service = container.resolve<ICustomerModuleService>(Modules.CUSTOMER)\n    const addresses = await service.listCustomerAddresses(selector, {\n' +
      '      select: ["id"],\n    })\n    return new StepResponse(addresses.map((address) => address.id))\n  }\n)')
    .replace('    const unsetInput = transform(input, (data) => ({',
      '    const addressIds = selectCustomerAddressIdsStep(input.selector)\n' +
      '    const updateInput = transform({ input, addressIds }, ({ input, addressIds }) => ({\n      ...input,\n      selector: { id: addressIds },\n    }))\n' +
      '    const unsetInput = transform(updateInput, (data) => ({')
    .replace('updateCustomerAddressesStep(input)', 'updateCustomerAddressesStep(updateInput)');
  verifyProgram(expected, target, targetPath);
}

/** The Customer module exposes the already-owned native metadata replacement
 * option without changing forward defaults or any neighboring method.
 * @param {string} source @param {string} target @param {string} targetPath */
export function verifyCustomerAddressUpdateSource(source, target, targetPath) {
  const pair = customerAddressUpdateSourcePairs.find(value => value.target === targetPath);
  if (pair === undefined) throw new Error("Unknown native Customer Address update source pair");
  let expected = source.replaceAll("\r\n", "\n");
  if (targetPath.startsWith("packages/medusa-customer/")) {
    expected = expected.replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    const start = expected.indexOf('  // @ts-expect-error\n  async updateCustomerAddresses(');
    const end = expected.indexOf('\n  async removeCustomerFromGroup(', start);
    if (start < 0 || end < start) throw new Error("Missing native Customer Address update owner");
    const update = expected.slice(start, end)
      .replaceAll('sharedContext?: Context\n', 'sharedContext?: Context,\n    options?: DAL.UpdateOptions\n')
      .replaceAll('@MedusaContext() sharedContext: Context = {}\n', '@MedusaContext() sharedContext: Context = {},\n    options?: DAL.UpdateOptions\n')
      .replaceAll('      sharedContext\n', '      sharedContext,\n      options\n');
    expected = expected.slice(0, start) + update + expected.slice(end);
  } else {
    expected = expected.replace('import { RestoreReturn, SoftDeleteReturn }', 'import { RestoreReturn, SoftDeleteReturn, UpdateOptions }')
      .replace(/(updateCustomerAddresses\([\s\S]*?sharedContext\?: Context)\n/g, '$1,\n    options?: UpdateOptions\n');
  }
  verifyProgram(expected, target, targetPath);
}

/** @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyCustomerAccountSelection(files) {
  const pairs = [...customerAddressSourcePairs, customerAccountLinkSourcePair, ...customerAddressUpdateSourcePairs];
  for (const pair of pairs) if (files.filter(file => file.source === pair.source && file.target === pair.target && file.classification === pair.classification).length !== 1)
    throw new Error("Changed native Customer Address/account selection");
  for (const file of files) if (file.target.startsWith("packages/medusa-core-flows/src/customer/") &&
    !pairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
    throw new Error("Unselected native Customer Address source");
  for (const file of files) if (file.classification === "customerAddressUpdateFork" &&
    !customerAddressUpdateSourcePairs.some(pair => pair.target === file.target && pair.source === file.source))
    throw new Error("Unselected native Customer Address update owner");
}

export function checkCustomerAccountSources(root = process.cwd()) {
  for (const pair of customerAddressSourcePairs) verifyCustomerAddressSource(readFileSync(path.join(root, pair.source), "utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  for (const pair of customerAddressUpdateSourcePairs) verifyCustomerAddressUpdateSource(readFileSync(path.join(root, pair.source), "utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  const pair = customerAccountLinkSourcePair;
  if (readFileSync(path.join(root, pair.source), "utf8").replaceAll("\r\n", "\n").replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"') !==
    readFileSync(path.join(root, pair.target), "utf8").replaceAll("\r\n", "\n")) throw new Error("Changed native Customer AccountHolder Link");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { checkCustomerAccountSources(); console.log("Verified native Customer Address and AccountHolder Link sources."); }
