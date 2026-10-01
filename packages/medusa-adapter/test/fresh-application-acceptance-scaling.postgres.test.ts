import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Effect, Schema, Tracer } from "effect";
import { expect, it, vi } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/logicalStorageDefinitions";
import { currencyCommands } from "../src/currency-service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { observeRetrievalPgClients, type RetrievalObservation } from
  "../benchmarks/core-performance/native-retrieval/observation";

const reportPath = process.env.FRESH_APPLICATION_SCALING_REPORT;
const count = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 })))(process.env.FRESH_APPLICATION_SCALING_SAMPLES ?? "1");
const variants = [
  { name: "baseline", options: {} },
  { name: "functionCount", options: { applicationAcceptanceScale: { extraFunctions: 32, functionPaddingBytes: 0 } } },
  { name: "functionBody", options: { applicationAcceptanceScale: { extraFunctions: 1, functionPaddingBytes: 32_768 } } },
  { name: "coldBody", options: { readinessRuntimeHostIdentity: `flarex.test/${"c".repeat(512)}` } },
  { name: "taskMembership", options: { includeApplicationTask: true } },
  { name: "sourceWidth", options: { includeProduct: true } },
  { name: "definitionCount", options: { includeUserNameIndex: true } },
] as const;
const sourcePaths = ["packages/medusa-adapter/test/fresh-application-acceptance-scaling.postgres.test.ts",
  "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
  "packages/persistence-postgres/test/fixtures/applicationNativeMutationTestFixture.ts",
  "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/observation.ts",
  "packages/persistence-postgres/src/applicationActivation.ts",
  "packages/persistence-postgres/src/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/applicationMutationAdmission.ts",
  "packages/persistence-postgres/src/applicationReadiness.ts",
  "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts",
  "packages/persistence-postgres/src/commerceTransaction/host.ts",
  "packages/persistence-postgres/src/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/exactRunningAttemptTail.ts", "pnpm-lock.yaml"];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
async function sourceEvidence() {
  return Promise.all(sourcePaths.map(async path => ({ path,
    sha256: hash(await readFile(new URL(`../../../${path}`, import.meta.url))) })));
}

// Opt-in structural scaling proof. Diagnostic tracing/hash interception is
// included in each full request; these samples are not quiet latency acceptance.
it.skipIf(reportPath === undefined || postgresUrl === null ||
  !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "keeps accepting immutable work absent while actual captured bodies and fresh breadth vary", async () => {
    if (reportPath === undefined) throw new Error("Missing scaling report path");
    const beforeSources = await sourceEvidence();
    const measureVariant = async (variant: typeof variants[number]) => {
      const cleanup: Array<() => Promise<void>> = [];
      const setupStart = performance.now();
      try {
        const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), {
          protectedRuntime: true, applicationAcceptanceScale: { extraFunctions: 1, functionPaddingBytes: 0 },
          ...variant.options,
        });
        const initialCode = fixture.initialization.rows[0]?.code;
        if (typeof initialCode !== "string") throw new Error("Missing initialized Currency code");
        const setupMs = performance.now() - setupStart;
        const evidenceStart = performance.now();
        const requirements = await Effect.runPromise(readLogicalStorageRequirements(
          fixture.control.drizzle, fixture.deploymentId, fixture.schemaVersionId));
        const breadth = { sources: requirements.evidence.candidate.sources.length,
          ordered: requirements.ordered.length, search: requirements.search.length, unique: requirements.unique.length };
        const immutable = (await fixture.persistence.query<{ kind: string; hex: string }>(
          `select 'function' as kind, encode(entry_bytes, 'hex') as hex from fx_system_application_function_v1
           union all select 'analysis', encode(manifest_bytes, 'hex') from fx_system_application_analysis_v1 where manifest_bytes is not null
           union all select 'catalog', encode(function_catalog_bytes, 'hex') from fx_system_application_publication_v1
           union all select 'schema', encode(schema_bytes, 'hex') from fx_system_application_publication_v1
           union all select 'readiness', encode(readiness_bytes, 'hex') from fx_system_application_readiness_v1
           union all select 'cold', encode(cold_receipt_bytes, 'hex') from fx_system_application_readiness_function_v1
           union all select 'taskCatalog', encode(binding_bytes, 'hex') from fx_system_application_task_catalog_v1
           union all select 'taskDefinition', encode(manifest_bytes, 'hex') from fx_system_application_task_definition_v1`
        )).rows;
        const taskRows = (await fixture.persistence.query<{ count: number }>(
          "select count(*)::int as count from fx_system_application_task_definition_v1")).rows[0]?.count;
        const immutableHashes = new Set(immutable.map(row => hash(Buffer.from(row.hex, "hex"))));
        const settings = (await fixture.persistence.query(
          "select version(), current_setting('transaction_isolation') as isolation, current_setting('jit') as jit"
        )).rows;
        const evidenceCaptureMs = performance.now() - evidenceStart;
        const samples = [];
        for (let sample = 0; sample < count; sample++) {
          const spans: Tracer.NativeSpan[] = [];
          const tracer = Tracer.make({ span(options) {
            const span = new Tracer.NativeSpan(options); spans.push(span); return span;
          } });
          const phase = () => spans.toReversed().find(span => span.status._tag !== "Ended" &&
            ["ApplicationReadiness.validateStoredIssuedReadiness", "PreparedMetadataEpoch.authenticateTargetSnapshot",
              "PreparedMetadataEpoch.guard", "ApplicationActivation.withPreparedBindingBasis"].includes(span.name))?.name;
          const sql: RetrievalObservation[] = [];
          const digests: Array<{ bytes: number; component?: string; immutable: boolean }> = [];
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          const digestObserver = vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
            const bytes = ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
            const component = phase();
            digests.push({ bytes: bytes.byteLength, immutable: immutableHashes.has(hash(bytes)),
              ...(component === undefined ? {} : { component }) });
            return digest(algorithm, data);
          });
          const restoreSql = observeRetrievalPgClients(sql, phase);
          const started = performance.now();
          try {
            const result = await Effect.runPromise(fixture.host.read(currencyCommands.retrieve,
              { code: initialCode }).pipe(Effect.withTracer(tracer)));
            const fullRequestMs = performance.now() - started;
            expect(result).toMatchObject({ code: initialCode });
            const acceptingSql = sql.filter(query => query.component !== undefined);
            const canonicalReads = acceptingSql.filter(query =>
              /\b(?:from|join)\s+"?fx_system_application_(?:revision_v2|candidate_v1|analysis_v1|function_v1|publication_v1|readiness_v1|readiness_function_v1|task_catalog_v1|task_definition_v1)"?\b/i.test(query.label));
            expect(canonicalReads).toEqual([]);
            expect(digests.filter(value => value.component !== undefined && value.immutable)).toEqual([]);
            expect(spans.filter(span => span.name === "PreparedMetadataEpoch.guard")).toHaveLength(1);
            const components = spans.filter(span => ["ApplicationReadiness.validateStoredIssuedReadiness",
              "PreparedMetadataEpoch.authenticateTargetSnapshot", "PreparedMetadataEpoch.guard"].includes(span.name))
              .map(span => {
                const status = span.status;
                if (status._tag !== "Ended" || status.exit._tag !== "Success")
                  throw new Error(`Invalid component observation: ${span.name}`);
                return { name: span.name, startNs: status.startTime.toString(), endNs: status.endTime.toString(),
                  inclusiveMs: Number(status.endTime - status.startTime) / 1e6 };
              });
            samples.push({ sample, fullRequestMs, components, sql, digests,
              canonicalAcceptingQueries: canonicalReads.length, canonicalAcceptingBodyBytes: 0 });
          } finally { restoreSql(); digestObserver.mockRestore(); }
        }
        return { name: variant.name, options: variant.options, setupMs, evidenceCaptureMs, settings, taskRows, breadth,
          captured: immutable.map(row => ({ kind: row.kind, bytes: row.hex.length / 2, sha256: hash(Buffer.from(row.hex, "hex")) })),
          samples };
      } finally { for (const close of cleanup.reverse()) await close(); }
    };
    const results: Array<Awaited<ReturnType<typeof measureVariant>>> = [];
    for (const variant of variants) results.push(await measureVariant(variant));
    const capturedBytes = (name: string, kind: string) => results.find(result => result.name === name)?.captured
      .filter(row => row.kind === kind).reduce((total, row) => total + row.bytes, 0) ?? 0;
    expect(capturedBytes("functionCount", "function")).toBeGreaterThan(capturedBytes("baseline", "function"));
    expect(capturedBytes("functionBody", "function")).toBeGreaterThan(capturedBytes("baseline", "function") + 32_000);
    expect(capturedBytes("coldBody", "cold")).toBeGreaterThan(capturedBytes("baseline", "cold"));
    expect(results.find(result => result.name === "baseline")?.taskRows).toBe(0);
    expect(results.find(result => result.name === "taskMembership")?.taskRows).toBe(1);
    const baseline = results.find(result => result.name === "baseline");
    const sourceWidth = results.find(result => result.name === "sourceWidth");
    const definitions = results.find(result => result.name === "definitionCount");
    if (baseline === undefined || sourceWidth === undefined || definitions === undefined)
      throw new Error("Incomplete scaling variants");
    expect(sourceWidth.breadth.sources).toBeGreaterThan(baseline.breadth.sources);
    expect(definitions.breadth.sources).toBe(baseline.breadth.sources);
    expect(definitions.breadth.ordered).toBeGreaterThan(baseline.breadth.ordered);
    const afterSources = await sourceEvidence();
    expect(afterSources).toEqual(beforeSources);
    await mkdir(dirname(resolve(reportPath)), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({ kind: "diagnosticStructuralScaling", count,
      unavailable: ["quietLatencyDistribution", "serverCpu", "canonicalDecoderInvocationCounter"],
      sources: beforeSources, results }, null, 2)}\n`);
  }, 600_000);
