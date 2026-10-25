// @ts-check
import ts from "@typescript/typescript6";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const native = "third_party/medusa/upstream/";
const moduleFiles = ["models/api-key.ts", "models/index.ts", "services/index.ts", "services/api-key-module-service.ts",
  "joiner-config.ts", "types/index.ts", "utils/api-key-crypto.ts", "static-manifest.ts"];
const typeFiles = ["common/api-key.ts", "common/index.ts", "mutations/api-key.ts", "mutations/index.ts", "index.ts", "service.ts"];
const flows = ["steps/create-api-keys.ts", "steps/update-api-keys.ts", "steps/revoke-api-keys.ts", "steps/delete-api-keys.ts",
  "steps/link-sales-channels-to-publishable-key.ts", "steps/validate-sales-channel-exists.ts", "workflows/create-api-keys.ts",
  "workflows/update-api-keys.ts", "workflows/revoke-api-keys.ts", "workflows/delete-api-keys.ts", "workflows/link-sales-channels-to-publishable-key.ts"];
export const apiKeySourcePairs = Object.freeze([
  ...moduleFiles.map(file => ({ source: native + "packages/modules/api-key/src/" + file, target: "packages/medusa-api-key/src/" + file })),
  ...typeFiles.map(file => ({ source: native + "packages/core/types/src/api-key/" + file, target: "packages/medusa-types/src/api-key/" + file })),
  { source: native + "packages/core/utils/src/api-key/api-key-type.ts", target: "packages/medusa-utils/src/api-key/api-key-type.ts" },
  { source: native + "packages/modules/link-modules/src/definitions/publishable-api-key-sales-channel.ts",
    target: "packages/medusa-link-modules/src/definitions/publishable-api-key-sales-channel.ts" },
  ...flows.map(file => ({ source: native + "packages/core/core-flows/src/api-key/" + file, target: "packages/medusa-core-flows/src/api-key/" + file })),
].map(pair => Object.freeze({ ...pair, classification: "apiKeyFork" })));

const inverse = `  /** Creation inverse only. Ordinary deletion keeps its revocation guard. */
  @InjectManager()
  @EmitEvents()
  async revertCreatedApiKeys(
    ids: string | string[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    return await this.revertCreatedApiKeys_(ids, sharedContext)
  }

  @InjectTransactionManager()
  protected async revertCreatedApiKeys_(
    ids: string | string[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    return await super.deleteApiKeys(ids, sharedContext)
  }

`;

/** Complete typed and emitted programs must match only the approved native
 * inverse, explicit portable model binding, import relocation and erased types.
 * @param {string} source @param {string} target @param {string} targetPath */
export function verifyApiKeySource(source, target, targetPath) {
  if (!apiKeySourcePairs.some(pair => pair.target === targetPath)) throw new Error("Unknown API Key source pair");
  let expected = source.replaceAll("\r\n", "\n").replaceAll('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replaceAll('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  if (targetPath === "packages/medusa-api-key/src/services/api-key-module-service.ts") {
    const marker = "  //@ts-expect-error\n  createApiKeys(\n    data: ApiKeyTypes.CreateApiKeyDTO[],";
    if (expected.split(marker).length !== 2) throw new Error("Changed native API Key insertion seam");
    expected = expected.replace(marker, inverse + marker);
  }
  if (targetPath === "packages/medusa-types/src/api-key/service.ts") expected = expected.replace(
    "export interface IApiKeyModuleService extends IModuleService {",
    "export interface IApiKeyModuleService extends IModuleService {\n" +
    "  /** Trusted creation compensation only; ordinary deletion remains guarded. */\n" +
    "  revertCreatedApiKeys(ids: string | string[], sharedContext?: Context): Promise<void>\n");
  if (targetPath === "packages/medusa-api-key/src/joiner-config.ts") expected = expected.replace(
    'import { defineJoinerConfig, Modules } from "@medusajs/framework/utils/portable"',
    'import { Modules } from "@medusajs/framework/utils/portable"\n' +
    'import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"\n' +
    'import { ApiKey } from "./models"').replace('defineJoinerConfig(Modules.API_KEY, {',
    'defineJoinerConfigFromModels(Modules.API_KEY, {\n  models: [ApiKey],');
  if (targetPath === "packages/medusa-core-flows/src/api-key/steps/create-api-keys.ts")
    expected = expected.replace("await service.deleteApiKeys(createdIds)", "await service.revertCreatedApiKeys(createdIds)");
  if (targetPath === "packages/medusa-link-modules/src/definitions/publishable-api-key-sales-channel.ts")
    expected = expected.replace('    idPrefix: "pksc",', '    idPrefix: "pksc",\n    workflowOperations: true,');
  for (const [file, name] of [["create-api-keys", "createApiKeysStep"], ["update-api-keys", "updateApiKeysStep"],
    ["revoke-api-keys", "revokeApiKeysStep"], ["delete-api-keys", "deleteApiKeysStep"]]) {
    if (targetPath.endsWith("/workflows/" + file + ".ts")) expected = expected.replace(
      'import { ' + name + ' } from "../steps"', 'import { ' + name + ' } from "../steps/' + file + '"');
    if (["create-api-keys", "update-api-keys"].includes(file) && targetPath.endsWith("/steps/" + file + ".ts"))
      expected = expected.replace("createStep(\n  " + name + "Id,", 'createStep(\n  { name: ' + name + 'Id, compensation: "transactionCovered" },');
    if (["revoke-api-keys", "delete-api-keys"].includes(file) && targetPath.endsWith("/steps/" + file + ".ts"))
      expected = expected.replace("{ name: " + name + "Id, noCompensation: true }", name + "Id")
        .replace("  },\n  async () => {}\n)", "  }\n)");
  }
  // This SDK records irreversible policy on the staged invocation. Preserve
  // the native noCompensation flag there; its empty compensator is unnecessary.
  if (targetPath.endsWith("/workflows/revoke-api-keys.ts")) expected = expected.replace(
    "revokeApiKeysStep(input)", "revokeApiKeysStep(input).config({ noCompensation: true })");
  if (targetPath.endsWith("/workflows/delete-api-keys.ts")) expected = expected
    .replace('import { createWorkflow, WorkflowData } from "@medusajs/workflows-sdk"',
      'import { createWorkflow, transform, WorkflowData, WorkflowResponse } from "@medusajs/workflows-sdk"')
    .replace('import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"',
      'import { removeApiKeyLinksStep } from "../steps/remove-api-key-links"')
    .replace('import { Modules } from "@medusajs/framework/utils/portable"\n', "")
    .replace("(input: WorkflowData<DeleteApiKeysWorkflowInput>): WorkflowData<void> =>", "(input: WorkflowData<DeleteApiKeysWorkflowInput>) =>")
    .replace("deleteApiKeysStep(input.ids)", "const deleted = deleteApiKeysStep(input.ids).config({ noCompensation: true })")
    .replace("    removeRemoteLinkStep({\n      [Modules.API_KEY]: { publishable_key_id: input.ids },\n    })",
      "    const ids = transform({ input, deleted }, ({ input }) => input.ids)\n" +
      "    removeApiKeyLinksStep(ids).config({ noCompensation: true })")
    .replace("  }\n)", "    return new WorkflowResponse(void 0)\n  }\n)");
  if (targetPath.endsWith("/workflows/link-sales-channels-to-publishable-key.ts")) expected = expected.replace(
    'import {\n  linkSalesChannelsToApiKeyStep,\n  validateSalesChannelsExistStep,\n} from "../steps"',
    'import { linkSalesChannelsToApiKeyStep } from "../steps/link-sales-channels-to-publishable-key"\n' +
    'import { validateSalesChannelsExistStep } from "../steps/validate-sales-channel-exists"')
    .replace('import { WorkflowData, createWorkflow } from "@medusajs/workflows-sdk"',
      'import { WorkflowData, createWorkflow, transform } from "@medusajs/workflows-sdk"')
    .replace("    validateSalesChannelsExistStep({", "    const add = transform(input, (data) => data.add ?? [])\n    validateSalesChannelsExistStep({")
    .replace("sales_channel_ids: input.add ?? [],", "sales_channel_ids: add,");
  if (targetPath.endsWith("/steps/link-sales-channels-to-publishable-key.ts")) {
    expected = expected.replace("  Modules,\n  promiseAll,\n", "")
      .replace('import { StepResponse, createStep } from "@medusajs/workflows-sdk"',
        'import { createStep } from "@medusajs/workflows-sdk"\nimport { applyApiKeyLinkOperation } from "../utils/link-operation"')
      .replace('import type { LinkWorkflowInput } from "@medusajs/framework/types"',
        'import type { LinkWorkflowInput } from "@medusajs/framework/types"\nimport type { Link } from "@medusajs/modules-sdk/link"')
      .replace("createStep(\n  linkSalesChannelsToApiKeyStepId,", 'createStep(\n  { name: linkSalesChannelsToApiKeyStepId, compensation: "transactionCovered" },')
      .replace("async (input: LinkSalesChannelsToApiKeyStepInput, { container })", "async (input: LinkSalesChannelsToApiKeyStepInput, { container, idempotencyKey })")
      .replace("container.resolve(ContainerRegistrationKeys.LINK)", 'container.resolve<Pick<Link, "applyOperation">>(ContainerRegistrationKeys.LINK)')
      .replace("container.resolve(ContainerRegistrationKeys.LINK)", 'container.resolve<Pick<Link, "compensateOperation">>(ContainerRegistrationKeys.LINK)');
    const forward = expected.indexOf("    const linksToCreate ="), inverse = expected.indexOf("  async (prevData, { container }) =>");
    if (forward < 0 || inverse <= forward) throw new Error("Changed native API Key association seam");
    expected = expected.slice(0, forward) + "    return await applyApiKeyLinkOperation(remoteLink, input, idempotencyKey)\n  },\n" + expected.slice(inverse);
    const undo = expected.indexOf("    if (prevData.linksToCreate.length)");
    if (undo < 0) throw new Error("Changed native API Key association inverse seam");
    expected = expected.slice(0, undo) + "    await remoteLink.compensateOperation(prevData)\n  }\n)\n";
  }
  /** @param {string} text */
  const programs = text => {
    const output = ts.transpileModule(text, { fileName: targetPath, reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, experimentalDecorators: true, removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    } });
    if (output.diagnostics?.some(issue => issue.category === ts.DiagnosticCategory.Error)) throw new Error("Invalid API Key fork syntax");
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    return [printer.printFile(ts.createSourceFile("api-key.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
      printer.printFile(ts.createSourceFile("api-key.js", output.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS))];
  };
  const a = programs(expected), b = programs(target);
  if (a[0] !== b[0] || a[1] !== b[1]) throw new Error("Changed native API Key source: " + targetPath);
}

/** @param {readonly {source?: string,target: string,classification: string}[]} files */
export function verifyApiKeySelection(files) {
  for (const pair of apiKeySourcePairs) if (files.filter(file => file.source === pair.source && file.target === pair.target &&
    file.classification === pair.classification).length !== 1) throw new Error("Changed API Key source selection");
  for (const file of files) if ((file.classification === "apiKeyFork" || apiKeySourcePairs.some(pair => pair.source === file.source || pair.target === file.target)) &&
    !apiKeySourcePairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
    throw new Error("Changed API Key source selection");
}

/** @param {string} root */
export function verifyApiKeyFiles(root) {
  const hashes = new Map(readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"), "utf8").trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error("Malformed pinned Medusa source manifest");
    return [match[2], match[1]];
  }));
  for (const pair of apiKeySourcePairs) {
    const source = readFileSync(path.join(root, pair.source));
    if (createHash("sha256").update(source).digest("hex") !== hashes.get(pair.source.slice("third_party/medusa/".length)))
      throw new Error("Changed pinned API Key source");
    verifyApiKeySource(source.toString("utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  }
  return { sourcePairs: apiKeySourcePairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyApiKeyFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} pinned API Key source pairs.\n`);
}
