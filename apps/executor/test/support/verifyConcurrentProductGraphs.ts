export interface ProductSubmissionReceipt {
  readonly phase: "warmup" | "preflight" | "load";
  readonly seq: number;
  readonly handle: string;
  readonly sku: string;
  readonly amount: number;
  readonly concurrency: number;
  readonly round: number;
  readonly status: number | null;
  readonly ms: number;
  readonly productId?: string;
  readonly variantId?: string;
  readonly error?: string;
  readonly responseBody?: string;
  readonly timedOut?: boolean;
}

type DurableRow = Readonly<Record<string, unknown>>;
const families = ["products", "options", "optionValues", "variants", "variantOptions", "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const;
type Family = typeof families[number];
export type ConcurrentProductGraphSnapshot = { readonly [Name in Family]: readonly DurableRow[] };
export type ConcurrentProductGraphOutcome = "complete" | "failed-before-commit" | "committed-after-error" | "incomplete-graph" | "missing-after-success";
export interface StoredConcurrentProductGraph {
  readonly productId: string;
  readonly variantId: string;
  readonly priceSetId: string;
  readonly priceId: string;
  readonly amount: string;
  readonly currency: string;
  readonly inventoryItemId: string;
  readonly sku: string;
  readonly requiredQuantity: number;
}
export interface ConcurrentProductGraphResult {
  readonly seq: number;
  readonly phase: ProductSubmissionReceipt["phase"];
  readonly handle: string;
  readonly sku: string;
  readonly status: number | null;
  readonly timedOut: boolean;
  readonly clientSucceeded: boolean;
  readonly outcome: ConcurrentProductGraphOutcome;
  readonly persistedProductIds: readonly string[];
  readonly durableComplete: boolean;
  readonly durableGraph?: StoredConcurrentProductGraph;
  readonly selectedRows: number;
  readonly errors: readonly string[];
}

const text = (row: DurableRow | undefined, key: string): string | undefined => {
  const value = row?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
const record = (value: unknown): value is DurableRow => value !== null && typeof value === "object" && !Array.isArray(value);
const clientSucceeded = (receipt: ProductSubmissionReceipt) => receipt.status === 200 && receipt.error === undefined && receipt.timedOut !== true
  && typeof receipt.productId === "string" && receipt.productId.length > 0 && typeof receipt.variantId === "string" && receipt.variantId.length > 0;

/** The workload submits positive safe integers. Compare the native persisted
 * decimal and its raw companion exactly, without a floating-point conversion. */
function exactAmount(value: unknown, expected: number): boolean {
  if (typeof value !== "string" || !Number.isSafeInteger(expected) || expected <= 0 || !/^[0-9]+(?:\.0+)?$/.test(value)) return false;
  return value.split(".")[0]?.replace(/^0+(?=\d)/, "") === String(expected);
}

function identity(family: Family, row: DurableRow): string | undefined {
  if (family !== "variantOptions") return text(row, "id");
  const variant = text(row, "variant_id"), value = text(row, "option_value_id");
  return variant === undefined || value === undefined ? undefined : JSON.stringify([variant, value]);
}

/** Independent post-close reconciliation for this exact one-option, one-value,
 * managed-variant/USD-price workload. This returns evidence on HTTP failures;
 * it neither retries requests nor infers durability from the response status. */
export function verifyConcurrentProductGraphs(input: Readonly<{
  receipts: readonly ProductSubmissionReceipt[];
  before: ConcurrentProductGraphSnapshot;
  after: ConcurrentProductGraphSnapshot;
}>) {
  const integrityErrors: string[] = [];
  const difference = (family: Family) => {
    const previous = new Set<string>();
    for (const row of input.before[family]) {
      const key = identity(family, row);
      if (key !== undefined) previous.add(key);
    }
    return input.after[family].filter(row => {
      const key = identity(family, row);
      if (key === undefined) { integrityErrors.push(`${family}: persisted row has no native identity`); return true; }
      return !previous.has(key);
    });
  };
  const created: ConcurrentProductGraphSnapshot = {
    products: difference("products"), options: difference("options"), optionValues: difference("optionValues"),
    variants: difference("variants"), variantOptions: difference("variantOptions"), priceSets: difference("priceSets"),
    prices: difference("prices"), inventoryItems: difference("inventoryItems"), variantPriceSets: difference("variantPriceSets"),
    variantInventoryItems: difference("variantInventoryItems"),
  };
  const ids = new Map<string, Family>();
  for (const family of families) {
    const seen = new Set<string>();
    for (const row of created[family]) {
      const key = identity(family, row);
      if (key !== undefined && seen.has(key)) integrityErrors.push(`${family}: duplicate persisted identity ${key}`);
      if (key !== undefined) seen.add(key);
      const id = family === "variantOptions" ? undefined : text(row, "id");
      if (id !== undefined) {
        const owner = ids.get(id);
        if (owner !== undefined && owner !== family) integrityErrors.push(`Native ID ${id} is shared by ${owner} and ${family}`);
        ids.set(id, family);
      }
      if (Object.hasOwn(row, "deleted_at") && row.deleted_at !== null) integrityErrors.push(`${family}: created row ${key ?? "unknown"} is deleted`);
    }
  }
  const submissions = new Map<string, number>();
  for (const receipt of input.receipts) {
    for (const [kind, value] of [["seq", String(receipt.seq)], ["handle", receipt.handle], ["sku", receipt.sku], ["amount", String(receipt.amount)]]) {
      const key = `${kind}:${value}`;
      if (submissions.has(key)) integrityErrors.push(`Submission ${receipt.seq}: ${kind} is not unique`);
      submissions.set(key, receipt.seq);
    }
    if (!Number.isSafeInteger(receipt.seq) || !Number.isSafeInteger(receipt.amount) || receipt.amount <= 0)
      integrityErrors.push(`Submission ${receipt.seq}: workload sequence/amount is invalid`);
  }
  const claimed = new Map<DurableRow, number>();
  const graphs: ConcurrentProductGraphResult[] = [];
  for (const receipt of input.receipts) {
    const errors: string[] = [];
    let selectedRows = 0;
    const fail = (message: string) => errors.push(`Submission ${receipt.seq} (${receipt.handle}): ${message}`);
    const one = (family: Family, matches: readonly DurableRow[]): DurableRow | undefined => {
      if (matches.length !== 1) fail(`expected one ${family} row, found ${matches.length}`);
      for (const row of matches) {
        const owner = claimed.get(row);
        if (owner !== undefined && owner !== receipt.seq) fail(`${family} row is shared with submission ${owner}`);
        else claimed.set(row, receipt.seq);
        selectedRows++;
      }
      return matches[0];
    };
    const owned = (family: Family, field: string, value: string | undefined) => value === undefined ? [] : created[family].filter(row => row[field] === value);
    const products = created.products.filter(row => row.handle === receipt.handle);
    const succeeded = clientSucceeded(receipt);
    if (products.length === 0) {
      const partial = created.variants.some(row => row.sku === receipt.sku) || created.inventoryItems.some(row => row.sku === receipt.sku)
        || created.prices.some(row => row.currency_code === "usd" && exactAmount(row.amount, receipt.amount));
      if (succeeded || partial) fail(succeeded ? "successful response has no persisted product" : "expected SKU/amount persisted without its product");
      integrityErrors.push(...errors);
      graphs.push({ seq: receipt.seq, phase: receipt.phase, handle: receipt.handle, sku: receipt.sku, status: receipt.status,
        timedOut: receipt.timedOut === true,
        clientSucceeded: succeeded, outcome: succeeded ? "missing-after-success" : partial ? "incomplete-graph" : "failed-before-commit",
        persistedProductIds: [], durableComplete: false, selectedRows, errors });
      continue;
    }
    const product = one("products", products), productId = text(product, "id");
    if (productId === undefined) fail("product ID is missing");
    const option = one("options", owned("options", "product_id", productId)), optionId = text(option, "id");
    if (option?.title !== "Size") fail("option title does not match Size");
    const value = one("optionValues", owned("optionValues", "option_id", optionId)), valueId = text(value, "id");
    if (value?.value !== "One") fail("option value does not match One");
    const variant = one("variants", owned("variants", "product_id", productId)), variantId = text(variant, "id");
    if (variant?.sku !== receipt.sku || variant?.manage_inventory !== true) fail("variant SKU/managed-inventory fields do not match its request");
    const pivot = one("variantOptions", owned("variantOptions", "variant_id", variantId));
    if (valueId === undefined || pivot?.option_value_id !== valueId) fail("variant-option pivot points to a different value");
    const priceLink = one("variantPriceSets", owned("variantPriceSets", "variant_id", variantId));
    const priceSet = one("priceSets", owned("priceSets", "id", text(priceLink, "price_set_id"))), priceSetId = text(priceSet, "id");
    const price = one("prices", owned("prices", "price_set_id", priceSetId));
    if (price?.currency_code !== "usd" || !exactAmount(price?.amount, receipt.amount)) fail("price amount/currency does not match its request and own price set");
    const raw = price?.raw_amount;
    if (!record(raw) || raw.precision !== 20 || !exactAmount(raw.value, receipt.amount)) fail("price raw amount/precision does not match its request");
    const inventoryLink = one("variantInventoryItems", owned("variantInventoryItems", "variant_id", variantId));
    const item = one("inventoryItems", owned("inventoryItems", "id", text(inventoryLink, "inventory_item_id")));
    if (inventoryLink?.required_quantity !== 1 || item?.sku !== receipt.sku) fail("inventory link quantity/SKU does not match its request");
    if (selectedRows !== 10) fail(`expected ten business rows, selected ${selectedRows}`);
    const priceId = text(price, "id"), amount = text(price, "amount"), currency = text(price, "currency_code");
    const inventoryItemId = text(item, "id"), sku = text(item, "sku"), requiredQuantity = inventoryLink?.required_quantity;
    const durableGraph = errors.length === 0 && productId !== undefined && variantId !== undefined && priceSetId !== undefined
      && priceId !== undefined && amount !== undefined && currency !== undefined && inventoryItemId !== undefined && sku !== undefined && requiredQuantity === 1
      ? { productId, variantId, priceSetId, priceId, amount, currency, inventoryItemId, sku, requiredQuantity } : undefined;
    const durableComplete = durableGraph !== undefined;
    if (!durableComplete && errors.length === 0) fail("persisted graph is missing an audit identity/value");
    if (succeeded && (receipt.productId !== productId || receipt.variantId !== variantId)) fail("successful response IDs do not match the persisted product/variant");
    integrityErrors.push(...errors);
    graphs.push({ seq: receipt.seq, phase: receipt.phase, handle: receipt.handle, sku: receipt.sku, status: receipt.status,
      timedOut: receipt.timedOut === true,
      clientSucceeded: succeeded, outcome: !durableComplete ? "incomplete-graph" : succeeded ? "complete" : "committed-after-error",
      persistedProductIds: products.flatMap(row => { const id = text(row, "id"); return id === undefined ? [] : [id]; }), durableComplete,
      ...(durableGraph === undefined ? {} : { durableGraph }), selectedRows, errors });
  }
  const orphanRows: { table: Family; id: string | undefined }[] = [];
  for (const family of families) for (const row of created[family]) if (!claimed.has(row)) orphanRows.push({ table: family, id: identity(family, row) });
  for (const orphan of orphanRows) integrityErrors.push(`${orphan.table}: orphan/unsubmitted row ${orphan.id ?? "without identity"}`);
  const unsuccessfulPersistedProducts = graphs.filter(graph => !graph.clientSucceeded && graph.persistedProductIds.length > 0)
    .map(graph => ({ seq: graph.seq, handle: graph.handle, status: graph.status, outcome: graph.outcome, productIds: graph.persistedProductIds }));
  return {
    counts: {
      submitted: input.receipts.length, successfulResponses: input.receipts.filter(clientSucceeded).length,
      unsuccessfulResponses: input.receipts.filter(receipt => !clientSucceeded(receipt)).length,
      timedOutResponses: input.receipts.filter(receipt => receipt.timedOut === true).length,
      persistedProducts: created.products.length, completeGraphs: graphs.filter(graph => graph.durableComplete).length,
      failedBeforeCommit: graphs.filter(graph => graph.outcome === "failed-before-commit").length,
      committedAfterError: graphs.filter(graph => graph.outcome === "committed-after-error").length,
      incompleteGraphs: graphs.filter(graph => graph.outcome === "incomplete-graph" || graph.outcome === "missing-after-success").length,
      persistedAfterUnsuccessful: unsuccessfulPersistedProducts.reduce((count, graph) => count + graph.productIds.length, 0),
      newBusinessRows: families.reduce((count, family) => count + created[family].length, 0), orphanRows: orphanRows.length,
    },
    graphs, unsuccessfulPersistedProducts, orphanRows, integrityErrors,
  };
}
