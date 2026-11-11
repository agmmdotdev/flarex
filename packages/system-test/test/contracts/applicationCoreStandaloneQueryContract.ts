import type { ApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { Cause, Exit } from "effect";
import { expect, it } from "vitest";
import { proveCoreApplicationNestedReadonly, proveCoreApplicationStandaloneCancelled,
  proveCoreApplicationStandalonePublicQuery, proveCoreApplicationStandaloneSnapshot,
  proveCoreApplicationStandaloneTerminals, proveCoreApplicationStandaloneMetadata,
  proveCoreApplicationStandaloneIdentity, proveCoreApplicationConfiguredProgramProfile,
  proveCoreApplicationFixedQueryTarget } from "../../support/applicationCoreStandaloneQueryHarness";

const readonlyMethods = { insert: "undefined", patch: "undefined", replace: "undefined", delete: "undefined",
  runMutation: "undefined", runAction: "undefined" };
function failures<A, E>(exit: Exit.Exit<A, E>): readonly E[] {
  return Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error) : [];
}

export function defineApplicationCoreStandaloneQueryContract(adapter: Readonly<{
  runScenario: <A>(scenario: (fixture: ApplicationCoreFixture) => Promise<A>) => Promise<A>;
}>): void {
  it("uses genuine cold Analysis and public typed runQuery without durable claims, outcomes or publication", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationStandalonePublicQuery);
    expect(proof.coldAnalysisLoads).toBe(2);
    expect(proof.functions).toContainEqual({ path: "users:typedQuery", kind: "query", visibility: "public" });
    expect(proof.functions).toContainEqual({ path: "users:getInternal", kind: "query", visibility: "internal" });
    expect(proof.value).toBe("Ada");
    expect(proof.anonymous).toEqual({ parent: null, child: null });
    expect([Exit.isFailure(proof.invalidArguments), Exit.isFailure(proof.internal), Exit.isFailure(proof.mutation),
      Exit.isFailure(proof.serverReturn), Exit.isFailure(proof.clientReturn)]).toEqual([true, true, true, true, true]);
    expect(failures(proof.invalidArguments)).toMatchObject([{ _tag: "CoreApplicationProgramError", reason: "argumentsInvalid" }]);
    expect(failures(proof.internal)).toMatchObject([{ _tag: "CoreApplicationQueryError", reason: "functionUnsupported" }]);
    expect(failures(proof.mutation)).toMatchObject([{ _tag: "CoreApplicationQueryError", reason: "functionUnsupported" }]);
    expect(failures(proof.serverReturn)).toMatchObject([{ _tag: "QueryInvocationError", reason: "executionFailed" }]);
    expect(failures(proof.clientReturn)).toMatchObject([{ _tag: "ApplicationResultContractError", operation: "query" }]);
    // Invalid arguments, internal visibility and a mutation target refuse before Worker loading.
    expect(proof.beforeReturnFailures).toBe(1);
    expect(proof.capability).toEqual({ methods: readonlyMethods, mutationRefused: true });
    expect(proof.after).toEqual(proof.before);
    expect(proof.tokens.length).toBeGreaterThan(0);
    expect(proof.tokens[0]?.timestamp).toBe(proof.before.timestamp);
    expect(proof.tokens[0]?.reads.length).toBeGreaterThan(0);
  }, 120_000);

  it("keeps query data, nested metadata and time at S through mutation publication", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationStandaloneSnapshot);
    expect(proof.publication.disposition).toBe("published");
    expect(proof.old.first).toMatchObject({ name: "Ada" });
    expect(proof.old.child).toEqual(proof.old.first);
    expect(proof.old.second).toEqual(proof.old.first);
    expect(proof.old.later).toBe(proof.old.now);
    expect(proof.old.capabilities).toEqual({ methods: readonlyMethods, mutationRefused: true });
    expect(proof.next.first).toMatchObject({ name: "parent-after-success" });
    expect(proof.next.child).toEqual(proof.next.first);
    expect(proof.next.second).toEqual(proof.next.first);
    expect(proof.next.later).toBe(proof.next.now);
    expect(proof.tokens[0]?.timestamp).toBe(proof.initialTimestamp);
    expect(proof.tokens[1]?.timestamp).toBeGreaterThan(proof.initialTimestamp);
    expect(proof.cold).toBe("parent-after-success");
  }, 120_000);

  it("evaluates two actual Worker queries at one fixed target while later writes publish and refuses lost history", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationFixedQueryTarget);
    expect(proof.fixed.first.value).toBe("Ada");
    expect(proof.fixed.second.value).toBe("Ada");
    expect(proof.fixed.first.token.timestamp).toBe(proof.fixed.target);
    expect(proof.fixed.second.token.timestamp).toBe(proof.fixed.target);
    expect(proof.fixed.mutation.disposition).toBe("published");
    expect(proof.fixed.unchanged).toBe(true);
    expect(proof.later.target).toBeGreaterThan(proof.fixed.target);
    expect(proof.later.changed).toBe(true);
    expect(proof.later.evaluation.value).toBe("parent-after-success");
    expect(proof.later.evaluation.token.timestamp).toBe(proof.later.target);
    expect(failures(proof.afterRelease)).toMatchObject([{ _tag: "CoreTransactionError", reason: "closed" }]);
    expect(failures(proof.cold.refresh)).toMatchObject([{ _tag: "CoreTransactionError", reason: "invalidValue" }]);
    expect(proof.cold.evaluation.value).toBe("parent-after-success");
    expect(proof.workerLoads).toBe(5);
  }, 120_000);

  it("borrows parent mutation pending state while giving nested query functions only readonly capabilities", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationNestedReadonly);
    expect(proof.result.disposition).toBe("published");
    expect(proof.snapshot.first).toMatchObject({ name: "parent pending" });
    expect(proof.snapshot.child).toEqual(proof.snapshot.first);
    expect(proof.snapshot.second).toEqual(proof.snapshot.first);
    expect(proof.snapshot.later).toBe(proof.snapshot.now);
    expect(proof.snapshot.capabilities).toEqual({ methods: readonlyMethods, mutationRefused: true });
    expect(proof.current).toBe("parent pending");
    expect(proof.history).toHaveLength(2);
    expect(proof.workerLoads).toBe(2);
    expect(proof.beginCount).toBe(2);
    expect(proof.queryBeginCount).toBe(0);
  }, 120_000);

  it("uses all existing SDK terminals, drains dropped reads and preserves a cursor across owner reopen", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationStandaloneTerminals);
    expect(proof.collected).toEqual(Array.from({ length: 260 }, (_, ordinal) => `row${ordinal.toString().padStart(3, "0")}`));
    expect(proof.taken).toEqual(["row000", "row001"]);
    expect(proof.first).toMatchObject({ name: "row000" });
    expect(proof.unique).toMatchObject({ name: "row117" });
    expect(proof.page.page.map(row => row.name)).toEqual(["row000", "row001"]);
    expect(proof.nextPage.page.map(row => row.name)).toEqual(["row002", "row003", "row004"]);
    expect(proof.dropped).toEqual({ dropped: true });
    expect(failures(proof.late)).toMatchObject([{ _tag: "ApplicationExecutionHostError", reason: "readBoundaryFailed" }]);
    expect(proof.after).toEqual(proof.before);
    expect(proof.tokens).toHaveLength(6);
    expect(proof.calls.filter(method => method === "queryStart")).toHaveLength(8);
    expect(proof.calls.filter(method => method === "queryCleanup")).toHaveLength(8);
  }, 120_000);

  it("cancels a held Worker without publication and admits the next read on the same owner", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationStandaloneCancelled);
    expect(Exit.isFailure(proof.outcome)).toBe(true);
    expect(proof.after).toEqual(proof.before);
    expect(proof.next).toBe("Ada");
    expect(proof.completedTokens).toBe(1);
  }, 120_000);

  it("fences a captured query after code publication while later calls select the newly analyzed catalogue", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationStandaloneMetadata);
    expect(failures(proof.old)).toMatchObject([{ _tag: "CoreTransactionError", reason: "authorityRevoked" }]);
    expect(proof.next).toBe(123);
    expect(Exit.isFailure(proof.badArguments)).toBe(true);
    expect(failures(proof.badArguments)).toMatchObject([{ _tag: "CoreApplicationProgramError", reason: "argumentsInvalid" }]);
    expect(proof.workerLoads).toBe(2);
    expect(new Set(proof.roots).size).toBe(2);
    expect(proof.tokens).toHaveLength(1);
    expect(proof.tokens[0]?.timestamp).toBeGreaterThan(proof.initialTimestamp);
    expect(proof.coldAnalysisLoads).toBe(2);
  }, 120_000);

  it("preserves the established user identity through nested readonly query calls", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationStandaloneIdentity);
    expect(proof.result).toEqual({ parent: proof.identity.user, child: { parent: proof.identity.user, child: null } });
    expect(proof.workerLoads).toBe(1);
  }, 120_000);

  it("refuses configured source, scope and epoch mismatches before source loads, grants or request claims", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationConfiguredProgramProfile);
    for (const result of proof.results) {
      const reason = result.name === "invalid" ? "metadataInvalid" : "unsupportedSelection";
      expect(failures(result.query), result.name).toMatchObject([{ _tag: "CoreApplicationProgramError", reason }]);
      expect(failures(result.mutation), result.name).toMatchObject([{ _tag: "CoreApplicationMutationError", reason }]);
    }
    expect(proof.sourceReads).toBe(0);
    expect(proof.claims).toBe(0);
    expect(proof.grants).toBe(0);
    expect(proof.workerLoads).toBe(0);
    expect(proof.after).toEqual(proof.before);
  }, 120_000);
}
