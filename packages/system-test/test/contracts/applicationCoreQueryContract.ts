import { expect, it } from "vitest";
import { Cause, Exit } from "effect";
import { CoreTransactionError } from "@flarex/persistence-postgres/internal/core";
import { CoreApplicationMutationError } from "@flarex/persistence-postgres/internal/core-application-mutation";
import { ApplicationPointMutationRunnerHostV1Error } from "@flarex/executor/internal/point-mutation-runner-errors";
import type { ApplicationCoreMutationFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-mutation-fixture";
import { proveCoreApplicationMissingQueryBridge, proveCoreApplicationQueryByteBudgets,
  proveCoreApplicationQuerySemanticByteBudgets,
  proveCoreApplicationQueryPagination, proveCoreApplicationQueryPendingAndDropped,
  proveCoreApplicationQueryTerminals, proveCoreApplicationQueryPageRevocation } from "../../support/applicationCoreQueryHarness";

export function defineApplicationCoreQueryContract(adapter: Readonly<{
  runScenario: <A>(scenario: (fixture: ApplicationCoreMutationFixture) => Promise<A>) => Promise<A>;
}>): void {
  it("executes all SDK terminals and both orders over more than one transport chunk from cold Analysis metadata", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationQueryTerminals);
    expect(proof.coldAnalysisLoads).toBe(2);
    expect(proof.manifestFunctions).toContain("users:queryProbe");
    for (const order of proof.orders) {
      const expected = order.order === "asc" ? proof.expected : proof.expected.toReversed();
      expect(order.collect).toEqual(expected);
      expect(order.take).toEqual(expected.slice(0, 200));
      expect(order.page.page.map(row => row.name)).toEqual(expected.slice(0, 200));
      expect(order.page.isDone).toBe(false);
      expect(order.first).toMatchObject({ name: expected[0] });
      expect(order.unique).toMatchObject({ name: "row117" });
      expect(order.nonunique).toMatchObject({ caught: true, name: "Error", message: "Query returned more than one document." });
    }
    expect(proof.fullScan).toHaveLength(2);
    expect(proof.zero).toEqual([]);
    expect(proof.largeTake).toEqual(proof.expected);
    expect(proof.creation).toMatchObject({ _id: proof.documentId });
    // take(0) is completed by the SDK without admitting a backend stream.
    expect(proof.calls.filter(call => call.method === "queryStart")).toHaveLength(15);
    expect(proof.calls.filter(call => call.method === "queryCleanup")).toHaveLength(15);
    expect(proof.calls.filter(call => call.method === "queryNext").length).toBeGreaterThan(15);
    expect(proof.calls.some(call => call.method === "queryIndexRange")).toBe(false);
    expect(proof.workerLoads).toBe(16);
  }, 120_000);

  it("authenticates query cursors across cold reopen, changed page size and deletion of the last yielded row", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationQueryPagination);
    expect(proof.first.page.map(row => row.name)).toEqual(["row000", "row001"]);
    expect(proof.first.isDone).toBe(false);
    expect(proof.first.continueCursor).toMatch(/^[0-9a-f]+$/);
    expect(proof.decodedPosition).toBe("after");
    expect(proof.second.page.map(row => row.name)).toEqual(["row002", "row003", "row004"]);
    // Filling the requested page consumes no extra document to infer End.
    expect(proof.second.isDone).toBe(false);
    expect(proof.end).toMatchObject({ page: [], isDone: true });
    expect(proof.repeatedEnd).toEqual(proof.end);
    expect(proof.maximumPage.page.map(row => row.name)).toEqual(["row000", "row002", "row003", "row004"]);
    expect(proof.maximumPage.isDone).toBe(true);
    expect(proof.refusals.map(refusal => refusal.name)).toEqual(["tamper", "order", "fingerprint", "instance", "malformed", "missingIndex", "pageSize"]);
    for (const refusal of proof.refusals) expect(refusal.outcome).toMatchObject({ caught: true, name: "Error" });
    expect(Exit.isFailure(proof.wrongScope)).toBe(true);
    if (Exit.isSuccess(proof.wrongScope)) throw new Error("Foreign broker scope was accepted.");
    expect(proof.wrongScope.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof CoreApplicationMutationError && reason.error.reason === "metadataInvalid")).toBe(true);
    expect(proof.wrongScopeWorkerLoads).toBe(0);
  }, 120_000);

  it("merges staged moves, deletes and inserts and drains a dropped multi-chunk terminal before settlement", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationQueryPendingAndDropped);
    expect(proof.pending).toEqual(["row000-new", ...Array.from({ length: 258 }, (_, ordinal) => `row${(ordinal + 2).toString().padStart(3, "0")}`), "row999"]);
    expect(proof.dropped).toEqual({ dropped: true });
    expect(proof.pages).toEqual([128, 128, 4]);
    expect(proof.calls.filter(method => method === "queryStart")).toHaveLength(1);
    expect(proof.calls.filter(method => method === "queryCleanup")).toHaveLength(1);
    expect(proof.calls.indexOf("queryCleanup")).toBeGreaterThan(proof.calls.lastIndexOf("queryNext"));
    expect(Exit.isFailure(proof.late)).toBe(true);
    if (Exit.isSuccess(proof.late)) throw new Error("A terminal started after closure was admitted.");
    expect(proof.late.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof ApplicationPointMutationRunnerHostV1Error && reason.error.reason === "journalBoundaryFailed")).toBe(true);
    expect(proof.lateCalls.filter(method => method === "queryStart")).toHaveLength(1);
    expect(proof.lateCalls.filter(method => method === "queryCleanup")).toHaveLength(1);
    expect(proof.latePages).toEqual([128, 128, 4]);
    expect(proof.workerLoads).toBe(3);
  }, 120_000);

  it("crosses the finite byte transport budget without an aggregate collection cap and keeps the operation read budget sticky", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationQueryByteBudgets);
    expect(proof.collected).toEqual(Array.from({ length: 10 }, (_, ordinal) => `row${ordinal.toString().padStart(3, "0")}`));
    expect(proof.collectionPages).toEqual([9, 1]);
    expect(Exit.isFailure(proof.outcome)).toBe(true);
    if (Exit.isSuccess(proof.outcome)) throw new Error("Query pages reset the operation read budget.");
    expect(proof.outcome.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof CoreTransactionError && reason.error.reason === "capacity")).toBe(true);
    expect(proof.document).toMatchObject({ name: "Ada" });
    expect(proof.workerLoads).toBe(2);
  }, 120_000);

  it("fails closed before user execution when the actual Worker bridge omits the managed query capability", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationMissingQueryBridge);
    expect(Exit.isFailure(proof.outcome)).toBe(true);
    if (Exit.isSuccess(proof.outcome)) throw new Error("The Worker omitted a required query bridge.");
    expect(proof.outcome.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof ApplicationPointMutationRunnerHostV1Error && reason.error.reason === "journalBoundaryFailed")).toBe(true);
    expect(proof.document).toMatchObject({ name: "Ada" });
    expect(proof.workerLoads).toBe(1);
    expect(proof.pointReads).toBe(0);
  }, 120_000);

  it("chunks compact numeric and nested arrays by semantic bytes for collect, take and pagination", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationQuerySemanticByteBudgets);
    expect(proof.coldAnalysisLoads).toBe(2);
    expect(proof.terminals.map(terminal => terminal.terminal)).toEqual(["collect", "take", "paginate"]);
    for (const terminal of proof.terminals) {
      expect(terminal.result).toBe(128);
      expect(terminal.pages).toHaveLength(2);
      expect(terminal.pages.flatMap(page => page.names)).toEqual(proof.expected);
      expect(terminal.pages.reduce((total, page) => total + page.encodedBytes, 0)).toBeLessThan(8 * 1024 * 1024);
      const totalSemanticBytes = terminal.pages.reduce((total, page) => total + page.semanticBytes, 0);
      expect(totalSemanticBytes).toBeGreaterThan(8 * 1024 * 1024);
      expect(totalSemanticBytes).toBeLessThan(16 * 1024 * 1024);
      for (const page of terminal.pages) {
        expect(page.count).toBeGreaterThan(0);
        expect(page.count).toBeLessThan(128);
        expect(page.encodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(page.semanticBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      }
    }
    expect(proof.workerLoads).toBe(3);
  }, 120_000);

  it("revalidates the real grant for every transport page and rolls back writes when authority changes", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationQueryPageRevocation);
    expect(Exit.isFailure(proof.outcome)).toBe(true);
    if (Exit.isSuccess(proof.outcome)) throw new Error("A revoked query grant continued its next page.");
    expect(proof.outcome.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof CoreApplicationMutationError && reason.error.reason === "revoked")).toBe(true);
    expect(proof.requestedPages).toBe(2);
    expect(proof.completedPages).toBe(1);
    expect(proof.document).toMatchObject({ name: "Ada" });
    expect(proof.workerLoads).toBe(1);
  }, 120_000);
}
