// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

const sourceRoot = "third_party/medusa/upstream/packages/medusa/src/api/";
const targetRoot = "packages/medusa-http/src/api/";
const names = ["store/carts/route.ts", "store/carts/[id]/route.ts", "store/carts/helpers.ts", "store/carts/query-config.ts",
  "store/carts/[id]/line-items/route.ts", "store/carts/[id]/line-items/[line_id]/route.ts",
  "store/carts/[id]/promotions/route.ts", "store/carts/[id]/taxes/route.ts",
  "store/carts/[id]/shipping-methods/route.ts", "store/shipping-options/route.ts", "store/shipping-options/validators.ts",
  "store/shipping-options/middlewares.ts", "store/shipping-options/query-config.ts",
  "store/carts/validators.ts", "store/carts/middlewares.ts", "utils/middlewares/common/ensure-pub-key-sales-channel-match.ts",
  "utils/middlewares/common/maybe-attach-pub-key-scopes.ts"];
export const storeCartHttpSourcePairs = names.map(name => ({ source: sourceRoot + name, target: targetRoot + name,
  classification: name.endsWith("query-config.ts") ? "unchanged" : "storeHttpFork" }));
/** @param {string} text */
const parse = text => ts.createSourceFile("cart.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
const print = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** @param {string} text @param {readonly string[]} names */
const declarations = (text, names) => {
  const file = parse(text);
  const selected = file.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)));
  if (selected.length !== names.length) throw new Error("Missing pinned Cart declaration");
  return selected.map(statement => statement.getText(file)).join("\n");
};
/** @param {string} text */
const runtime = text => {
  const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  const file = parse(output);
  const imports = file.statements.filter(ts.isImportDeclaration).map(statement => print.printNode(ts.EmitHint.Unspecified, statement, file)).sort();
  const body = file.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => print.printNode(ts.EmitHint.Unspecified, statement, file));
  /** @param {string} value */
  const canonical = value => {
    const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, value);
    /** @type {[import("@typescript/typescript6").SyntaxKind, string][]} */
    const tokens = [];
    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push([scanner.getToken(), scanner.getTokenText()]);
    return tokens.filter((token, index) => token[0] !== ts.SyntaxKind.CommaToken
      || ![ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseParenToken].includes(tokens[index + 1]?.[0]));
  };
  return JSON.stringify([imports.map(canonical), body.map(canonical)]);
};

/** Selected native algorithms permit only type and import relocation.
 * @param {string} native @param {string} promoted @param {string} target */
export function verifyStoreCartHttpSource(native, promoted, target) {
  if (!storeCartHttpSourcePairs.some(pair => pair.target === target)) throw new Error("Unselected Store Cart source");
  let expected = native.replaceAll("\r\n", "\n");
  const name = target.slice(targetRoot.length);
  if (["store/carts/route.ts", "store/carts/[id]/route.ts", "store/carts/[id]/line-items/route.ts",
    "store/carts/[id]/line-items/[line_id]/route.ts", "store/carts/[id]/promotions/route.ts", "store/carts/[id]/taxes/route.ts",
    "store/carts/[id]/shipping-methods/route.ts", "store/shipping-options/route.ts"].includes(name)) {
    expected = expected.replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"');
  } else if (name === "store/carts/helpers.ts") {
    expected = expected.replace(/import \{\s*ContainerRegistrationKeys,\s*MedusaError,\s*remoteQueryObjectFromString,\s*\} from "@medusajs\/framework\/utils"/,
      'import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"\nimport { MedusaError } from "@medusajs/utils/common/errors"\nimport { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"');
  } else if (name === "utils/middlewares/common/maybe-attach-pub-key-scopes.ts") {
    expected = expected.replace(/import \{\s*ContainerRegistrationKeys,\s*remoteQueryObjectFromString,\s*\} from "@medusajs\/framework\/utils"/,
      'import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"\nimport { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"');
  } else if (name === "store/carts/validators.ts") {
    expected = 'import { z } from "@medusajs/framework/zod"\nimport { AddressPayload } from "../../utils/common-validators"\nimport { createSelectParams, WithAdditionalData } from "../../utils/validators"\n'
      + declarations(expected, ["StoreGetCartsCart", "ItemSchema", "CreateCart", "StoreCreateCart", "StoreAddCartPromotions", "StoreRemoveCartPromotions", "StoreCartUpsertAddress",
        "UpdateCart", "StoreUpdateCart", "StoreCalculateCartTaxes", "StoreAddCartLineItem", "StoreUpdateCartLineItem", "StoreAddCartShippingMethods"]);
  } else if (name === "store/carts/middlewares.ts") {
    const file = parse(expected);
    const statement = file.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === "storeCartRoutesMiddlewares"));
    const declaration = statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0] : undefined;
    if (declaration?.initializer === undefined || !ts.isArrayLiteralExpression(declaration.initializer)) throw new Error("Missing native Cart middleware");
    const elements = declaration.initializer.elements;
    expected = 'import { validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"\n'
      + 'import { ensurePublishableKeyAndSalesChannelMatch } from "../../utils/middlewares/common/ensure-pub-key-sales-channel-match"\n'
      + 'import { maybeAttachPublishableKeyScopes } from "../../utils/middlewares/common/maybe-attach-pub-key-scopes"\n'
      + 'import * as QueryConfig from "./query-config"\nimport { StoreCreateCart, StoreGetCartsCart, StoreUpdateCart, StoreAddCartLineItem, StoreUpdateCartLineItem, StoreAddCartPromotions, StoreRemoveCartPromotions, StoreCalculateCartTaxes, StoreAddCartShippingMethods } from "./validators"\n'
      + 'export const storeCartRoutesMiddlewares = [' + [0, 1, 2, 4, 5, 6, 7, 8, 9, 10].map(index => elements[index].getText(file)).join(",") + ']';
  } else if (name === "store/shipping-options/validators.ts") {
    expected = 'import { z } from "@medusajs/framework/zod"\nimport { applyAndAndOrOperators, booleanString } from "../../utils/common-validators"\nimport { createFindParams } from "../../utils/validators"\n'
      + declarations(expected, ["StoreGetShippingOptionsFields", "StoreGetShippingOptions"]);
  } else if (name === "store/shipping-options/middlewares.ts") {
    const file = parse(expected);
    const statement = file.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === "storeShippingOptionRoutesMiddlewares"));
    const declaration = statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0] : undefined;
    if (declaration?.initializer === undefined || !ts.isArrayLiteralExpression(declaration.initializer)) throw new Error("Missing native Shipping Option middleware");
    expected = 'import { validateAndTransformQuery } from "@medusajs/framework/http"\nimport { listTransformQueryConfig } from "./query-config"\nimport { StoreGetShippingOptions } from "./validators"\n'
      + 'export const storeShippingOptionRoutesMiddlewares = [' + declaration.initializer.elements[0].getText(file) + ']';
  }
  if (runtime(expected) !== runtime(promoted)) throw new Error("Changed native Store Cart behavior: " + target);
}

/** @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyStoreCartHttpSelection(files) {
  for (const pair of storeCartHttpSourcePairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0].source !== pair.source || selected[0].classification !== pair.classification)
      throw new Error("Unpinned Store Cart HTTP selection: " + pair.target);
  }
}

/** The default address validator and request-error envelope come from native owners.
 * @param {string} root */
export function verifyStoreCartHttpSharedSources(root) {
  /** @param {string} file */
  const read = file => readFileSync(path.join(root, file), "utf8");
  const native = read(sourceRoot + "utils/common-validators/common.ts");
  const promoted = read(targetRoot + "utils/common-validators.ts");
  if (runtime(declarations(native, ["AddressPayload"])) !== runtime(declarations(promoted, ["AddressPayload"])))
    throw new Error("Changed native Cart Address validator");
  const wrapper = read("third_party/medusa/upstream/packages/core/framework/src/http/utils/wrap-handler.ts");
  const fetch = read("packages/medusa-framework/src/http/fetch.ts");
  const message = 'Provided request body contains errors. Please check the data and retry the request';
  if (!wrapper.includes(message) || !wrapper.includes("errors: req_.errors") || !wrapper.includes("res.status(400).json"))
    throw new Error("Changed native request-error source");
  const file = parse(fetch);
  const helper = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "respondToRequestErrors");
  const expected = `function respondToRequestErrors(req, res) { if (!req.errors?.length) return false; res.status(400).json({ errors: req.errors, message: ${JSON.stringify(message)} }); return true; }`;
  if (helper === undefined || runtime(helper.getText(file)) !== runtime(expected)
    || !fetch.includes("if (respondToRequestErrors(req, res)) { proceed = false; break }")
    || !fetch.includes("if (proceed && !respondToRequestErrors(req, res)) await route.handler(req, res)"))
    throw new Error("Fetch must preserve native request-error refusal before middleware and route");
}
