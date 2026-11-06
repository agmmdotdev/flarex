// Native lane: pinned upstream Medusa createProductsWorkflow / updateProductsWorkflow
// with the Core lane's module set, seeds and per-request input.
import { container, flows, meter, runWorkflow, settings, shutdownNative } from "./native-app";
import { productCreateInput, productUpdateInput, summarize, writeReport, type Sample } from "./shared";

const created: Sample[] = [], updated: Sample[] = [];
const tag = Date.now().toString(36);
for (let index = 0; index < settings.warmups + settings.samples; index += 1) {
  const prefix = `native${tag}-${index}`;
  const create = await meter.measure(() => runWorkflow(flows.createProductsWorkflow(container).run({ input: productCreateInput(prefix), throwOnError: false })));
  const change = await meter.measure(() => runWorkflow(flows.updateProductsWorkflow(container).run({
    input: productUpdateInput(prefix + "-product", index), throwOnError: false })));
  if (index >= settings.warmups) { created.push(create); updated.push(change); }
}
const summaries = [summarize("native-product-create", created), summarize("native-product-update", updated)];
const path = writeReport("native", { settings, summaries, raw: { created, updated } });
console.info(JSON.stringify({ path, summaries }));
await shutdownNative();
process.exit(summaries.every(summary => summary.failures === 0) ? 0 : 1);
