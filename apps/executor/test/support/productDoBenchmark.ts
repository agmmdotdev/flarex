import { Result, Schema } from "effect";
import type { ProductSubmissionReceipt } from "./verifyConcurrentProductGraphs";

export type ProductBenchmarkSubmission = Pick<ProductSubmissionReceipt,
  "phase" | "seq" | "handle" | "sku" | "amount" | "concurrency" | "round">;

const only = <S extends Schema.Top>(schema: S) => Schema.Array(schema).check(Schema.isLengthBetween(1, 1));
const decodeResponse = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({ product: Schema.Struct({
  id: Schema.NonEmptyString, handle: Schema.String,
  options: only(Schema.Struct({ id: Schema.String, title: Schema.Literal("Size"),
    values: only(Schema.Struct({ id: Schema.String, value: Schema.Literal("One") })) })),
  variants: only(Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String, manage_inventory: Schema.Literal(true),
    options: only(Schema.Struct({ id: Schema.String, value: Schema.Literal("One"), option_id: Schema.String })) })),
}) })));

export function productBenchmarkInput(sample: ProductBenchmarkSubmission) {
  return { title: `Warm DO Product ${sample.seq}`, handle: sample.handle, options: [{ title: "Size", values: ["One"] }],
    variants: [{ title: "Managed One", sku: sample.sku, manage_inventory: true, options: { Size: "One" },
      prices: [{ currency_code: "usd", amount: sample.amount }] }] };
}

type Transport = (sample: ProductBenchmarkSubmission, signal: AbortSignal) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

/** One measurement edge around a genuine HTTP submission, with no client retry.
 * Timed-out foreign work remains retained until the owning DO has closed. */
export function makeProductBenchmarkClient(input: Readonly<{
  send: Transport; timeoutMs: number; redact: (value: string) => string;
}>) {
  const pending = new Set<Promise<ProductSubmissionReceipt>>();
  const unexpectedFailures: unknown[] = [];
  let interruptedByTimeout = false;
  const submit = async (sample: ProductBenchmarkSubmission): Promise<ProductSubmissionReceipt> => {
    if (interruptedByTimeout) throw new Error("Cannot dispatch benchmark HTTP work after a request timeout");
    const started = performance.now();
    const controller = new AbortController();
    let status: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = (async (): Promise<ProductSubmissionReceipt> => {
      try {
        const response = await input.send(sample, controller.signal);
        status = response.status;
        const body = await response.text();
        const ms = performance.now() - started;
        const decoded = status === 200 ? decodeResponse(body) : undefined;
        const receipt: ProductSubmissionReceipt = { ...sample, status, ms };
        if (decoded === undefined) return { ...receipt, responseBody: input.redact(body), error: `HTTP ${status}` };
        if (Result.isFailure(decoded)) return { ...receipt, responseBody: input.redact(body), error: "Invalid native Product HTTP response" };
        const product = decoded.success.product;
        const variant = product.variants[0], option = product.options[0], value = option?.values[0];
        const selection = variant?.options[0];
        const correct = product.handle === sample.handle && variant?.sku === sample.sku
          && selection?.id === value?.id && selection?.option_id === option?.id;
        return { ...receipt, productId: product.id,
          ...(variant === undefined ? {} : { variantId: variant.id }),
          ...(correct ? {} : { error: "Returned Product graph does not match its submitted handle/SKU/option", responseBody: input.redact(body) }) };
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        return { ...sample, status, ms: performance.now() - started, error: input.redact(message) };
      }
    })();
    pending.add(operation);
    void operation.then(() => { pending.delete(operation); }, cause => { unexpectedFailures.push(cause); pending.delete(operation); });
    const timeout = new Promise<ProductSubmissionReceipt>(resolve => {
      timer = setTimeout(() => {
        interruptedByTimeout = true;
        controller.abort("product-benchmark-request-timeout");
        resolve({ ...sample, status, ms: performance.now() - started, timedOut: true,
          error: `HTTP request timed out after ${input.timeoutMs}ms` });
      }, input.timeoutMs);
    });
    try { return await Promise.race([operation, timeout]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
  return { submit, isInterrupted: () => interruptedByTimeout, drain: async () => {
    await Promise.allSettled([...pending]);
    if (unexpectedFailures.length > 0) throw new AggregateError([...unexpectedFailures], "Benchmark HTTP work failed outside its transport boundary");
  } };
}

export interface ProductBenchmarkCohort {
  readonly phase: ProductSubmissionReceipt["phase"];
  readonly concurrency: number;
  readonly round: number;
  readonly requested: number;
  readonly interruptedByTimeout: boolean;
  readonly peakInFlight: number;
  readonly startedAtEpochMs: number;
  readonly endedAtEpochMs: number;
  readonly startedAtMonotonicMs: number;
  readonly endedAtMonotonicMs: number;
  readonly wallMs: number;
  readonly receipts: readonly ProductSubmissionReceipt[];
}

/** Closed-loop workers submit the next distinct intent only after the prior
 * HTTP result/body. The first timeout prevents further dispatch; already
 * dispatched siblings still produce receipts. Probes/setup are outside timing. */
export async function runProductBenchmarkCohort(input: Readonly<{
  phase: ProductSubmissionReceipt["phase"]; concurrency: number; round: number; count: number;
  next: () => ProductBenchmarkSubmission;
  submit: (sample: ProductBenchmarkSubmission) => Promise<ProductSubmissionReceipt>;
  isInterrupted: () => boolean;
  onReceipt: (receipt: ProductSubmissionReceipt) => void;
}>): Promise<ProductBenchmarkCohort> {
  const startedAtEpochMs = Date.now(), startedAtMonotonicMs = performance.now();
  const receipts: ProductSubmissionReceipt[] = [];
  let next = 0, active = 0, peakInFlight = 0;
  await Promise.all(Array.from({ length: Math.min(input.concurrency, input.count) }, async () => {
    while (next < input.count && !input.isInterrupted()) {
      const index = next++;
      const sample = input.next();
      active++;
      peakInFlight = Math.max(peakInFlight, active);
      try {
        const receipt = await input.submit(sample);
        receipts[index] = receipt;
        input.onReceipt(receipt);
      } finally { active--; }
    }
  }));
  const endedAtMonotonicMs = performance.now(), endedAtEpochMs = Date.now();
  return { phase: input.phase, concurrency: input.concurrency, round: input.round, requested: input.count, peakInFlight,
    interruptedByTimeout: input.isInterrupted(),
    startedAtEpochMs, endedAtEpochMs, startedAtMonotonicMs, endedAtMonotonicMs,
    wallMs: endedAtMonotonicMs - startedAtMonotonicMs, receipts };
}

export function isSuccessfulProductReceipt(receipt: ProductSubmissionReceipt): boolean {
  return receipt.timedOut !== true && receipt.status === 200 && receipt.error === undefined
    && receipt.productId !== undefined && receipt.variantId !== undefined;
}

function latency(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return { minimum: sorted[0] ?? null, p50: at(0.5), p95: at(0.95), p99: at(0.99), maximum: sorted.at(-1) ?? null };
}

export function summarizeProductBenchmarkCohorts(cohorts: readonly ProductBenchmarkCohort[], eligible: boolean) {
  const primaryRatesEligible = eligible && cohorts.every(cohort => !cohort.interruptedByTimeout
    && cohort.receipts.length === cohort.requested && cohort.receipts.every(receipt => receipt.timedOut !== true));
  const summarize = (receipts: readonly ProductSubmissionReceipt[], wallMs: number) => {
    const successes = receipts.filter(isSuccessfulProductReceipt);
    return { submitted: receipts.length, successful: successes.length, failed: receipts.length - successes.length,
      http200: receipts.filter(receipt => receipt.status === 200).length,
      invalidHttp200: receipts.filter(receipt => receipt.status === 200 && !isSuccessfulProductReceipt(receipt)).length,
      non200Responses: receipts.filter(receipt => receipt.status !== null && receipt.status !== 200).length,
      transportErrors: receipts.filter(receipt => receipt.status === null).length,
      timedOut: receipts.filter(receipt => receipt.timedOut === true).length,
      statuses: Object.fromEntries([...new Set(receipts.map(receipt => String(receipt.status)))].map(status =>
        [status, receipts.filter(receipt => String(receipt.status) === status).length])),
      wallMs, attemptsPerSecond: primaryRatesEligible && wallMs > 0 ? receipts.length * 1000 / wallMs : null,
      successesPerSecond: primaryRatesEligible && wallMs > 0 ? successes.length * 1000 / wallMs : null,
      allLatencyMs: latency(receipts.map(receipt => receipt.ms)), successfulLatencyMs: latency(successes.map(receipt => receipt.ms)) };
  };
  return {
    primaryRatesEligible,
    cohorts: cohorts.map(cohort => ({ phase: cohort.phase, concurrency: cohort.concurrency, round: cohort.round,
      requested: cohort.requested, interruptedByTimeout: cohort.interruptedByTimeout,
      peakInFlight: cohort.peakInFlight, startedAtEpochMs: cohort.startedAtEpochMs, endedAtEpochMs: cohort.endedAtEpochMs,
      startedAtMonotonicMs: cohort.startedAtMonotonicMs, endedAtMonotonicMs: cohort.endedAtMonotonicMs,
      ...summarize(cohort.receipts, cohort.wallMs) })),
    pooledLoad: [1, 2, 4, 8].map(concurrency => {
      const selected = cohorts.filter(cohort => cohort.phase === "load" && cohort.concurrency === concurrency);
      return { concurrency, ...summarize(selected.flatMap(cohort => cohort.receipts), selected.reduce((sum, cohort) => sum + cohort.wallMs, 0)) };
    }),
    percentileMethod: "nearest rank",
  };
}
