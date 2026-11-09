import { afterEach, expect, it, vi } from "vitest";
import { makeProductBenchmarkClient, runProductBenchmarkCohort, summarizeProductBenchmarkCohorts,
  type ProductBenchmarkSubmission } from "./productDoBenchmark";

afterEach(() => { vi.useRealTimers(); });

const sample = (seq: number): ProductBenchmarkSubmission => ({ phase: "load", seq, handle: `product-${seq}`,
  sku: `SKU-${seq}`, amount: 1000 + seq, concurrency: 2, round: 1 });
const body = (submission: ProductBenchmarkSubmission) => JSON.stringify({ product: {
  id: `prod_${submission.seq}`, handle: submission.handle,
  options: [{ id: `opt_${submission.seq}`, title: "Size", values: [{ id: `val_${submission.seq}`, value: "One" }] }],
  variants: [{ id: `variant_${submission.seq}`, sku: submission.sku, manage_inventory: true,
    options: [{ id: `val_${submission.seq}`, value: "One", option_id: `opt_${submission.seq}` }] }],
} });

it("stops dispatch on timeout, retains sibling receipts and drains foreign work before ending", async () => {
  vi.useFakeTimers();
  const dispatched: ProductBenchmarkSubmission[] = [];
  const complete: Array<() => void> = [];
  const client = makeProductBenchmarkClient({ timeoutMs: 20, redact: value => value,
    send: async submission => {
      dispatched.push(submission);
      return { status: 200, text: () => new Promise<string>(resolve => { complete.push(() => resolve(body(submission))); }) };
    } });
  let seq = 0;
  const receiptSequences: number[] = [];
  const run = () => runProductBenchmarkCohort({ phase: "load", concurrency: 2, round: 1, count: 10,
    next: () => sample(++seq), submit: client.submit, isInterrupted: client.isInterrupted,
    onReceipt: receipt => { receiptSequences.push(receipt.seq); } });
  const running = run();
  await vi.advanceTimersByTimeAsync(20);
  const cohort = await running;
  expect(dispatched.map(item => item.seq)).toEqual([1, 2]);
  expect(receiptSequences.sort()).toEqual([1, 2]);
  expect(cohort.receipts.every(receipt => receipt.timedOut === true)).toBe(true);
  expect(cohort.interruptedByTimeout).toBe(true);
  expect(cohort.requested).toBe(10);
  expect((await run()).receipts).toEqual([]);
  await expect(client.submit(sample(3))).rejects.toThrow("after a request timeout");
  expect(dispatched).toHaveLength(2);
  const summary = summarizeProductBenchmarkCohorts([cohort], true);
  expect(summary.primaryRatesEligible).toBe(false);
  expect(summary.cohorts[0]?.attemptsPerSecond).toBeNull();
  expect(summary.pooledLoad.every(tier => tier.successesPerSecond === null)).toBe(true);
  let drained = false;
  const draining = client.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  complete.forEach(resolve => { resolve(); });
  await draining;
  expect(drained).toBe(true);
});

it("keeps complete successful closed-loop scheduling and requires explicit rate eligibility", async () => {
  const client = makeProductBenchmarkClient({ timeoutMs: 1000, redact: value => value,
    send: async submission => ({ status: 200, text: async () => body(submission) }) });
  let seq = 0;
  const cohort = await runProductBenchmarkCohort({ phase: "load", concurrency: 2, round: 1, count: 6,
    next: () => sample(++seq), submit: client.submit, isInterrupted: client.isInterrupted, onReceipt: () => {} });
  expect(cohort.receipts).toHaveLength(6);
  expect(cohort.interruptedByTimeout).toBe(false);
  expect(cohort.receipts.every(receipt => receipt.status === 200 && receipt.error === undefined)).toBe(true);
  expect(summarizeProductBenchmarkCohorts([cohort], true).primaryRatesEligible).toBe(true);
  expect(summarizeProductBenchmarkCohorts([cohort], false).cohorts[0]?.attemptsPerSecond).toBeNull();
  await client.drain();
});
