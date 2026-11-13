// @ts-check
import ts from "@typescript/typescript6";
import { createHash } from "node:crypto";

const sourceRoot = "third_party/medusa/upstream/packages/core/core-flows/src/";
const targetRoot = "packages/medusa-core-flows/src/";
const names = ["order/workflows/get-order-detail.ts", "order/workflows/get-orders-list.ts", "order/utils/aggregate-status.ts"];
export const storeOrderReadSourcePairs = [...names.map(name => ({ source: sourceRoot + name, target: targetRoot + name, classification: "workflowFork" })),
  { source: "third_party/medusa/upstream/packages/modules/link-modules/src/definitions/order-fulfillment.ts",
    target: "packages/medusa-link-modules/src/definitions/order-fulfillment.ts", classification: "importRelocation" }];
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** @param {string} text */
function program(text) {
  const parse = (/** @type {string} */ value) => ts.createSourceFile("order.ts", value, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } });
  return [printer.printFile(parse(text)), printer.printFile(parse(output.outputText))];
}
/** Exact native programs, with portable imports and checked partial DTO views.
 * @param {string} source @param {string} target */
export function adaptStoreOrderReadSource(source, target) {
  if (!storeOrderReadSourcePairs.some(pair => pair.target === target)) throw new Error("Unselected Store Order workflow");
  let expected = source.replaceAll("\r\n", "\n")
    .replaceAll('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replaceAll('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  if (target.endsWith("/definitions/order-fulfillment.ts")) return expected;
  if (target.endsWith("get-order-detail.ts")) {
    expected = expected.replace('import type { OrderDetailDTO } from "@medusajs/framework/types"',
      'import { decodeStoreOrderStatusView, type StoreOrderStatusView } from "../../common/steps/store-order-query-views"')
      .replace('from "../../common"', 'from "../../common/steps/use-query-graph"')
      .replaceAll("WorkflowResponse<OrderDetailDTO>", "WorkflowResponse<StoreOrderStatusView>")
      .replace("const order_ = order as OrderDetailDTO", "const order_ = decodeStoreOrderStatusView(order)")
      .replace(' as OrderDetailDTO["payment_status"]', "").replace(' as OrderDetailDTO["fulfillment_status"]', "");
  } else if (target.endsWith("get-orders-list.ts")) {
    const start = expected.indexOf("export type GetOrdersListWorkflowOutput =");
    const end = expected.indexOf("export type GetOrdersListWorkflowInput =", start);
    if (start < 0 || end < 0) throw new Error("Missing native Order list types");
    expected = expected.slice(0, start) + "export type GetOrdersListWorkflowOutput = StoreOrderListResult\n\n" + expected.slice(end);
    expected = expected.replace('import type { OrderDetailDTO, OrderDTO } from "@medusajs/framework/types"',
      'import { decodeStoreOrderStatusView, type StoreOrderListResult, type StoreOrderListVariables } from "../../common/steps/store-order-query-views"')
      .replace(/variables\?: Record<string, any> & \{[\s\S]*?\n  \}/, "variables: StoreOrderListVariables")
      .replace('from "../../common"', 'from "../../common/steps/use-remote-query"')
      .replace("const orders: OrderDTO[] = useRemoteQueryStep", "const orders = useRemoteQueryStep")
      .replace("const orders_ = orders as any", "const orders_ = orders")
      .replace("const data = orders_.rows ? orders_.rows : orders_", "const data = orders_.rows")
      .replace("const order_ = order as OrderDetailDTO", "const order_ = decodeStoreOrderStatusView(order)")
      .replace(' as OrderDetailDTO["payment_status"]', "").replace(' as OrderDetailDTO["fulfillment_status"]', "")
      .replace("// @ts-ignore\n            delete order_.payment_collections", "delete order.payment_collections")
      .replace("// @ts-ignore\n            delete order_.fulfillments", "delete order.fulfillments");
  } else {
    expected = expected.replace('import type { OrderDetailDTO } from "@medusajs/framework/types"',
      'import type { StoreOrderStatusView } from "../../common/steps/store-order-query-views"')
      .replaceAll("(order: OrderDetailDTO)", "(order: StoreOrderStatusView)")
      .replace('import {\n  defaultCurrencies,\n  getEpsilonFromDecimalPrecision,\n  isDefined,\n  MathBN,\n} from "@medusajs/framework/utils/portable"',
        'import { defaultCurrencies } from "@medusajs/utils/defaults/currencies"\nimport { getEpsilonFromDecimalPrecision } from "@medusajs/utils/totals/big-number"\nimport { isDefined, MathBN } from "@medusajs/framework/utils/portable"')
      .replace("let paymentStatus = {}", "let paymentStatus: Record<string, number> = {}")
      .replace("let fulfillmentStatus = {}", "let fulfillmentStatus: Record<string, number> = {}")
      .replaceAll("paymentStatus[PaymentStatus[status]]", "paymentStatus[PaymentStatus[status as keyof typeof PaymentStatus]]!")
      .replaceAll(/paymentStatus\[(PaymentStatus\.[A-Z_]+|paymentCollection\.status)\]/g, "$&!")
      .replaceAll("fulfillmentStatus[FulfillmentStatus[status]]", "fulfillmentStatus[FulfillmentStatus[status as keyof typeof FulfillmentStatus]]!")
      .replaceAll("fulfillmentStatus[statusMap[key]]", "fulfillmentStatus[statusMap[key as keyof typeof statusMap]]!")
      .replaceAll(/fulfillmentStatus\[FulfillmentStatus\.[A-Z_]+\]/g, "$&!")
      .replace("MathBN.lt(i.detail.raw_fulfilled_quantity, i.raw_quantity)", "MathBN.lt(i.detail.raw_fulfilled_quantity, i.raw_quantity!)");
  }
  return expected;
}
/** @param {string} source @param {string} target @param {string} targetPath */
export function verifyStoreOrderReadSource(source, target, targetPath) {
  const expected = program(adaptStoreOrderReadSource(source, targetPath)), actual = program(target);
  if (expected[0] !== actual[0] || expected[1] !== actual[1]) throw new Error("Changed native Store Order read workflow: " + targetPath);
}
/** @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyStoreOrderReadSelection(files) {
  for (const pair of storeOrderReadSourcePairs) if (files.filter(file => file.source === pair.source && file.target === pair.target && file.classification === pair.classification).length !== 1)
    throw new Error("Missing exact Store Order read source: " + pair.target);
  for (const file of files) if (storeOrderReadSourcePairs.some(pair => pair.source === file.source || pair.target === file.target) &&
    !storeOrderReadSourcePairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
    throw new Error("Redirected Store Order read source");
}

/** Preserve every pre-existing deprecated-step branch. The selected native
 * Order producer alone gains its counted callable Query envelope.
 * @param {string} text */
export function verifyStoreOrderRemoteQueryExtension(text) {
  const file = ts.createSourceFile("remote.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @type {import("@typescript/typescript6").IfStatement[]} */
  const selected = [];
  const visit = (/** @type {import("@typescript/typescript6").Node} */ node) => {
    if (ts.isIfStatement(node) && node.expression.getText(file) === "isStoreOrderListQuery(data)") selected.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const branch = selected[0];
  if (selected.length !== 1 || branch === undefined) throw new Error("Missing named Store Order remote query branch");
  const expected = `if (isStoreOrderListQuery(data)) {
    const query = container.resolve<(input: { readonly entryPoint: "orders"; readonly fields: readonly string[];
      readonly variables: typeof data.variables }) => Promise<unknown>>("query");
    const result = await query({ entryPoint: "orders", fields: data.fields, variables: data.variables });
    return new StepResponse(Result.getOrThrow(decodeStoreOrderListResult(result).pipe(Result.mapError(() =>
      new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Store Order page" })))));
  }`;
  if (program(branch.getText(file))[1] !== program(expected)[1]) throw new Error("Changed named Store Order native Query forwarding");
  const without = text.slice(0, branch.getStart(file)) + text.slice(branch.end);
  const stripped = without.replace(/^import \{ StoreOrderListQuery[^\n]*from "\.\/store-order-query-views";\r?\n/m, "")
    .replace("Schema.Union([StoreOrderListQuery, ListInput", "Schema.Union([ListInput");
  // The concurrent Effect 4.1.4 migration replaces preserve annotations with
  // explicit JSON rest schemas. Authenticate those exact declarations before
  // comparing every other pre-existing runtime statement to the original pin.
  const projectionMigration = [
    [
      `const retainedProperties = Schema.Record(Schema.String, Schema.Json);`,
      `const retainedProjection = { parseOptions: { onExcessProperty: "preserve" as const } };`,
    ],
    [
      `const PaymentCollectionView = Schema.StructWithRest(Schema.Struct({ id: Schema.String, amount: Schema.Number.check(Schema.isFinite()), raw_amount: RawAmount, currency_code: Schema.String,
        payment_sessions: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, authorized_at: Schema.NullOr(Schema.String) }), [retainedProperties])) }), [retainedProperties]);`,
      `const PaymentCollectionView = Schema.Struct({ id: Schema.String, amount: Schema.Number.check(Schema.isFinite()), raw_amount: RawAmount, currency_code: Schema.String,
        payment_sessions: Schema.Array(Schema.Struct({ id: Schema.String, authorized_at: Schema.NullOr(Schema.String) }).annotate(retainedProjection)) }).annotate(retainedProjection);`,
    ],
    [
      `const PaymentCustomerView = Schema.StructWithRest(Schema.Struct({ id: Schema.String, email: Schema.String, company_name: Schema.NullOr(Schema.String),
        first_name: Schema.NullOr(Schema.String), last_name: Schema.NullOr(Schema.String), phone: Schema.NullOr(Schema.String),
        addresses: Schema.Array(Schema.JsonObject), account_holders: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, provider_id: Schema.String,
          data: Schema.JsonObject }), [retainedProperties])), metadata: Schema.NullOr(Schema.JsonObject) }), [retainedProperties]);`,
      `const PaymentCustomerView = Schema.Struct({ id: Schema.String, email: Schema.String, company_name: Schema.NullOr(Schema.String),
        first_name: Schema.NullOr(Schema.String), last_name: Schema.NullOr(Schema.String), phone: Schema.NullOr(Schema.String),
        addresses: Schema.Array(Schema.JsonObject), account_holders: Schema.Array(Schema.Struct({ id: Schema.String, provider_id: Schema.String,
          data: Schema.JsonObject }).annotate(retainedProjection)), metadata: Schema.NullOr(Schema.JsonObject) }).annotate(retainedProjection);`,
    ],
    [
      `const RefundOrderView = Schema.Struct({ id: Schema.String, total: Schema.Finite, currency_code: Schema.String,
        region_id: Schema.NullOr(Schema.String), summary: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({
          pending_difference: Schema.optionalKey(Schema.Finite), raw_pending_difference: Schema.optionalKey(RawAmount),
        }), [retainedProperties]))) });`,
      `const RefundOrderView = Schema.Struct({ id: Schema.String, total: Schema.Finite, currency_code: Schema.String,
        region_id: Schema.NullOr(Schema.String), summary: Schema.optionalKey(Schema.NullOr(Schema.Struct({
          pending_difference: Schema.optionalKey(Schema.Finite), raw_pending_difference: Schema.optionalKey(RawAmount),
        }).annotate(retainedProjection))) });`,
    ],
  ];
  let runtime = program(stripped)[1];
  const declaration = (/** @type {string} */ source) => program(source)[1].replace(/^"use strict";\n/, "");
  for (const [current, previous] of projectionMigration) runtime = runtime.replace(declaration(current), declaration(previous));
  const hash = createHash("sha256").update(runtime).digest("hex");
  if (hash !== "6f5b476eab6959af32907b31daad839af003c07769db5eedaec06c2b817f4711") throw new Error("Changed an existing native remote query branch");
}
