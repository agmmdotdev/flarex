// Core lane: genuine createProductsWorkflow / updateProductsWorkflow roots through
// the shared Core owner, ordinary-role PostgreSQL, hosts prepared once outside timing.
import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect } from "effect";
import pg from "pg";
import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { prepareProductCreationWorkflow } from "../../../src/workflows/product/creation";
import { productCreationOptions } from "../../../test/support/core-product-creation-fixture";
import { prepareCoreProductUpdate } from "../../../test/support/core-product-update-fixture";
import { benchmarkSettings, meterPgClient, productCreateInput, productUpdateInput, summarize, writeReport, type Sample } from "./shared";

const settings = benchmarkSettings();
// Source default is 100 percent; any other value is a separately labeled diagnostic.
const verifyPercent = process.env.BENCH_VERIFY_PERCENT === undefined ? undefined : Number(process.env.BENCH_VERIFY_PERCENT);
if (verifyPercent !== undefined && !(Number.isSafeInteger(verifyPercent) && verifyPercent >= 0 && verifyPercent <= 100))
  throw new Error("BENCH_VERIFY_PERCENT must be an integer from 0 to 100");
const meter = meterPgClient(pg.Client.prototype, settings.rttMs);
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductUpdate>>;
beforeAll(async () => {
  connected = await prepareCoreProductUpdate("postgres", close => cleanup.push(close),
    verifyPercent === undefined ? {} : { indexCache: { verifyPercent } });
}, 600_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); meter.restore(); });

it("measures Core Product create and update roots", async () => {
  const creation = await Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(connected.creation), hooks: {} }));
  cleanup.push(() => Effect.runPromise(creation.close));
  const update = await connected.prepare({});
  const created: Sample[] = [], updated: Sample[] = [];
  const run = (work: Effect.Effect<unknown, unknown>) => Effect.runPromise(work);
  const tag = Date.now().toString(36);
  const profilePath = process.env.BENCH_PROFILE;
  const session = profilePath === undefined ? undefined : new Session();
  if (session !== undefined) { session.connect(); await session.post("Profiler.enable"); await session.post("Profiler.setSamplingInterval", { interval: 200 }); }
  for (let index = 0; index < settings.warmups + settings.samples; index += 1) {
    if (session !== undefined && index === settings.warmups) await session.post("Profiler.start");
    const prefix = `core${tag}-${index}`;
    const create = await meter.measure(() => run(creation.run(creation.newRequestKey(), productCreateInput(prefix))));
    const change = await meter.measure(() => run(update.run(update.newRequestKey(), productUpdateInput(prefix + "-product", index))));
    if (index >= settings.warmups) { created.push(create); updated.push(change); }
  }
  if (session !== undefined && profilePath !== undefined) {
    const { profile } = await session.post("Profiler.stop");
    writeFileSync(profilePath, JSON.stringify(profile));
    session.disconnect();
  }
  meter.clearStatements();
  await meter.measure(() => run(creation.run(creation.newRequestKey(), productCreateInput(`core${tag}-census`))));
  const createStatements = meter.statements();
  meter.clearStatements();
  await meter.measure(() => run(update.run(update.newRequestKey(), productUpdateInput(`core${tag}-census-product`, -1))));
  const updateStatements = meter.statements();
  const summaries = [summarize("core-product-create", created), summarize("core-product-update", updated)];
  const path = writeReport("core", { settings: { ...settings, verifyPercent: verifyPercent ?? 100 }, summaries,
    raw: { created, updated }, statements: { create: createStatements, update: updateStatements } });
  console.info(JSON.stringify({ path, summaries }));
  expect(summaries.every(summary => summary.failures === 0)).toBe(true);
}, 3_600_000);
