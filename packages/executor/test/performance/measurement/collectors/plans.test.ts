import { Result, Schema } from "effect";
import { appendFile, mkdtemp, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServerPlanCapture, SERVER_PLAN_LOG_PREFIX, ServerPlanEvidenceSchema, type ServerPlanLimits } from "./plans";

const fileBoundary = vi.hoisted(() => {
  const state: { closeFailure: Error | undefined; closeGate: Promise<void> | undefined;
    opened: Array<{ handle: FileHandle; closeCalls: number }> } = {
    closeFailure: undefined, closeGate: undefined, opened: [],
  };
  return state;
});
vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    const owned = { handle, closeCalls: 0 };
    fileBoundary.opened.push(owned);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      owned.closeCalls++;
      await close();
      await fileBoundary.closeGate;
      if (fileBoundary.closeFailure !== undefined) throw fileBoundary.closeFailure;
    };
    return handle;
  } };
});
beforeEach(() => {
  fileBoundary.closeFailure = undefined; fileBoundary.closeGate = undefined;
  fileBoundary.opened.length = 0;
});

const database = "fx_measurement";
const node = (fields: Record<string, unknown> = {}) => ({ "Node Type": "Result", "Actual Rows": 1, "Actual Loops": 1,
  "Startup Cost": 0, "Total Cost": 0.01, "Plan Rows": 1, "Plan Width": 4, ...fields });
const header = (db = database, queryId = "-9223372036854775808", pid = 123, sessionId = "68abcdef.7b") =>
  `FXPLAN[${pid}][${db}][${sessionId}][${queryId}]`;
function loggedPlan(json: string, queryId = "-9223372036854775808", db = database) {
  return `${header(db, queryId)}LOG:  duration: 1.234 ms  plan:\n\t${json.replaceAll("\n", "\n\t")}\n`;
}
function plan(fields: Record<string, unknown> = {}, root: Record<string, unknown> = {}, db = database,
  queryId = "-9223372036854775808") {
  // The actual PG18 stderr shape: auto_explain changes its JSON envelope to an
  // object; elog inserts a tab after each embedded newline, including the first.
  const json = JSON.stringify({ "Query Text": "select 'private-query-value'",
    Plan: node(fields), ...root }, null, 2);
  // Keep the PG numeric token exact; a JavaScript number rounds signed int64 max.
  return loggedPlan(`{"Query Identifier": 9223372036854775807,${json.slice(1)}`, queryId, db);
}
async function fixture(limits?: Partial<ServerPlanLimits>) {
  const directory = await mkdtemp(join(tmpdir(), "flarex-plan-capture-"));
  const path = join(directory, "postgres.log");
  await writeFile(path, `${header()}LOG:  prior query outside capture\n`);
  return { path, directory, capture: createServerPlanCapture({ database, source: { path, prefix: SERVER_PLAN_LOG_PREFIX }, ...(limits === undefined ? {} : { limits }) }),
    close: () => rm(directory, { recursive: true, force: true }) };
}

describe("bounded actual PostgreSQL plan log capture", () => {
  it("reads only appended real-format plans and retains exact signed IDs with whitelisted metrics", async () => {
    const state = await fixture();
    try {
      await state.capture.begin();
      await appendFile(state.path, plan({
        "Node Type": "Aggregate", "Shared Hit Blocks": 5,
        Output: ["private-output-value"], Filter: "email = 'private-filter-value'",
        "Relation Name": "private-relation", "Index Name": "private-index", "Function Call": "private-function()",
        Plans: [node({ "Node Type": "Seq Scan", "Actual Rows": 3.5, "Actual Loops": 2,
          "Rows Removed by Filter": 4, "Shared Read Blocks": 2, "I/O Read Time": 0.4,
          Output: ["private-child-output"], "Index Cond": "password = 'private-index-condition'" })],
      }, { Triggers: [{ "Trigger Name": "private-trigger", "Relation": "private-trigger-relation", Time: 0.25, Calls: 1 }],
        Settings: { arbitrary: "private-setting" }, Parameters: "private-parameter" }));
      await state.capture.end();
      const evidence = state.capture.evidence();
      expect(evidence).toMatchObject({ status: "complete", coverage: "observedLogWindowOnly", flushCompleteness: "unproven",
        ignoredBlocks: 0, foreignDatabasePlans: 0, failures: [] });
      expect(evidence.plans).toHaveLength(1);
      expect(evidence.plans[0]).toMatchObject({ header: { backendPid: 123, database, sessionId: "68abcdef.7b", queryId: "-9223372036854775808" },
        queryId: "9223372036854775807", durationMs: 1.234, nodes: [
          { id: 0, parentId: null, nodeType: "Aggregate", metrics: { "Shared Hit Blocks": 5 } },
          { id: 1, parentId: 0, nodeType: "Seq Scan", metrics: { "Actual Rows": 3.5, "I/O Read Time": 0.4 } },
        ], triggers: [{ ordinal: 0, timeMs: 0.25, calls: 1 }] });
      expect(JSON.stringify(evidence)).not.toContain("private-");
      expect(JSON.stringify(evidence)).not.toContain("Query Identifier");
      expect(Result.isSuccess(Schema.decodeUnknownResult(ServerPlanEvidenceSchema)(evidence))).toBe(true);
      const before = JSON.stringify(state.capture.evidence());
      Object.assign(evidence.plans[0]!.nodes[0]!.metrics, { "Shared Hit Blocks": 99 });
      expect(JSON.stringify(state.capture.evidence())).toBe(before);
      expect(state.capture.failures()).toEqual([]);
    } finally { await state.capture.end(); await state.close(); }
  });

  it("preserves literal numeric plan IDs across int64 bounds and adjacent unsafe integers independently of logged context", async () => {
    const ids = ["-9223372036854775808", "9223372036854775807", "9007199254740992", "9007199254740993", "0"];
    const state = await fixture();
    try {
      await state.capture.begin();
      for (const id of ids) await appendFile(state.path, loggedPlan(`{"Query Identifier":${id},"Plan":${JSON.stringify(node())}}`, "0"));
      await state.capture.end();
      const evidence = state.capture.evidence();
      expect(evidence.status).toBe("complete");
      expect(evidence.plans.map(value => value.queryId)).toEqual(ids);
      expect(evidence.plans.map(value => value.header.queryId)).toEqual(ids.map(() => "0"));
      const restored: unknown = JSON.parse(JSON.stringify(evidence));
      expect(Result.getOrThrow(Schema.decodeUnknownResult(ServerPlanEvidenceSchema)(restored)).plans.map(value => value.queryId)).toEqual(ids);
    } finally { await state.capture.end(); await state.close(); }
  });

  it("recognizes escaped root keys while excluding nested IDs and field-looking private strings", async () => {
    const state = await fixture();
    const privateText = 'private-query ",} Query Identifier: 17 { \\ "Query Identifier":19';
    try {
      await state.capture.begin();
      const root = JSON.stringify({ "Query Text": privateText, Plan: node({ "Query Identifier": 17,
        Output: [privateText], Plans: [node({ "Query Identifier": 19 })] }),
        Triggers: [{ Calls: 1, "Query Identifier": 23 }], Settings: { "Query Identifier": 29 } });
      await appendFile(state.path, loggedPlan(root));
      await appendFile(state.path, loggedPlan(`{"Query\\u0020Identifier":9007199254740993,${root.slice(1)}`));
      await state.capture.end();
      const evidence = state.capture.evidence();
      expect(evidence.status).toBe("complete");
      expect(evidence.plans.map(value => value.queryId)).toEqual([null, "9007199254740993"]);
      expect(JSON.stringify(evidence)).not.toContain("private-");
      expect(JSON.stringify(evidence)).not.toContain("Query Identifier");
    } finally { await state.capture.end(); await state.close(); }
  });

  for (const token of ["null", '"private-id"', "true", "{}", "[]", "1.0", "1e3", "-0",
    "9223372036854775808", "-9223372036854775809"]) {
    it(`refuses invalid plan query ID token ${token} without retaining private values`, async () => {
      const state = await fixture();
      try {
        await state.capture.begin();
        await appendFile(state.path, loggedPlan(`{"Query Identifier":${token},"Plan":${JSON.stringify(node())}}`));
        await expect(state.capture.end()).rejects.toMatchObject({ reason: "invalidPlanQueryId", cause: { _tag: "SchemaError" } });
        expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
        expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      } finally { await state.capture.end(); await state.close(); }
    });
  }

  for (const fields of ['"Query Identifier":1,"Query Identifier":2',
    '"Query Identifier":1,"Query Identifier":1', '"Query Identifier":1,"Query\\u0020Identifier":2']) {
    it(`refuses duplicate root query identity ${fields}`, async () => {
      const state = await fixture();
      try {
        await state.capture.begin();
        await appendFile(state.path, loggedPlan(`{${fields},"Plan":${JSON.stringify(node())}}`));
        await expect(state.capture.end()).rejects.toMatchObject({ reason: "duplicatePlanQueryId" });
        expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
      } finally { await state.capture.end(); await state.close(); }
    });
  }

  it("distinguishes foreign database plans and non-plan context without lending their identity or text", async () => {
    const state = await fixture();
    try {
      await state.capture.begin();
      await appendFile(state.path, plan({}, {}, "fx_foreign") + `${header()}CONTEXT:  SQL statement private-context\n\tprivate-continuation\n` + plan({}, {}, database, "9223372036854775807"));
      await state.capture.end();
      expect(state.capture.evidence()).toMatchObject({ status: "complete", foreignDatabasePlans: 1, ignoredBlocks: 1 });
      expect(state.capture.evidence().plans.map(value => value.header.queryId)).toEqual(["9223372036854775807"]);
      expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      expect(JSON.stringify(state.capture.evidence())).not.toContain("fx_foreign");
    } finally { await state.capture.end(); await state.close(); }
  });

  it("retains actual PostgreSQL 18 timing-off triggers with unavailable time instead of zero or dropped entries", async () => {
    const state = await fixture();
    // Whitelisted projection of target plan 28 in the private live window
    // [44901362, 52363770). SQL, names and predicates are excluded; omitted
    // node timings and trigger Time remain omitted exactly as logged by PG18.
    const projected = {
      Plan: { "Node Type": "ModifyTable", "Startup Cost": 0, "Total Cost": 0.01, "Plan Rows": 1,
        "Plan Width": 1076, "Actual Rows": 1, "Actual Loops": 1, "Shared Hit Blocks": 31,
        "Shared Read Blocks": 0, "Shared Dirtied Blocks": 2, "Shared Written Blocks": 4,
        Plans: [{ "Node Type": "Result", "Startup Cost": 0, "Total Cost": 0.01, "Plan Rows": 1,
          "Plan Width": 1076, "Actual Rows": 1, "Actual Loops": 1, "Shared Hit Blocks": 0,
          "Shared Read Blocks": 0, "Shared Dirtied Blocks": 0, "Shared Written Blocks": 0 }] },
      Triggers: [{ Calls: 1 }, { Calls: 1 }],
    };
    try {
      await state.capture.begin();
      const json = JSON.stringify(projected, null, 2);
      await appendFile(state.path, `${header()}LOG:  duration: 1.234 ms  plan:\n\t${json.replaceAll("\n", "\n\t")}\n`);
      await state.capture.end();
      const evidence = state.capture.evidence();
      expect(evidence.status).toBe("complete");
      expect(evidence.plans).toHaveLength(1);
      expect(evidence.plans[0]!.triggers).toEqual([
        { ordinal: 0, timeMs: null, calls: 1 }, { ordinal: 1, timeMs: null, calls: 1 },
      ]);
      expect(evidence.plans[0]!.nodes).toHaveLength(2);
      expect(evidence.plans[0]!.nodes[0]!.metrics["Shared Hit Blocks"]).toBe(31);
      expect(evidence.plans[0]!.nodes[0]!.metrics).not.toHaveProperty("Actual Total Time");
      expect(Result.isSuccess(Schema.decodeUnknownResult(ServerPlanEvidenceSchema)(evidence))).toBe(true);
    } finally { await state.capture.end(); await state.close(); }
  });

  it("classifies invalid trigger statistics while retaining Schema rejection and excluding raw values", async () => {
    for (const trigger of [{ Time: null, Calls: 1 }, { Time: "private-time", Calls: 1 }, {}, { Calls: -1 }, { Calls: 1.5 }]) {
      const state = await fixture();
      try {
        await state.capture.begin(); await appendFile(state.path, plan({}, { Triggers: [trigger] }));
        await expect(state.capture.end()).rejects.toMatchObject({ _tag: "ServerPlanCaptureFailure",
          reason: "invalidTriggerStats", cause: { _tag: "SchemaError" } });
        expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
        expect(state.capture.evidence().failures[0]!.tokens).toContain("invalidTriggerStats");
        expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      } finally { await state.capture.end(); await state.close(); }
    }
  });

  it("resets independent sequential windows after closing and rejects concurrent ownership", async () => {
    const state = await fixture();
    try {
      await state.capture.begin();
      await expect(state.capture.begin()).rejects.toMatchObject({ reason: "concurrentPlanCapture" });
      await appendFile(state.path, plan());
      await state.capture.end();
      expect(state.capture.evidence().status).toBe("incomplete");
      await state.capture.begin();
      await appendFile(state.path, plan({}, {}, database, "17"));
      await state.capture.end();
      expect(state.capture.evidence()).toMatchObject({ status: "complete", failures: [] });
      expect(state.capture.evidence().plans.map(value => value.header.queryId)).toEqual(["17"]);
      expect(state.capture.failures()).toEqual([]);
    } finally { await state.capture.end(); await state.close(); }
  });

  it("refuses unsupported source configuration and partial acquisition while closing its handle", async () => {
    const state = await fixture();
    try {
      const wrong = createServerPlanCapture({ database, source: { path: state.path, prefix: "%m [%p] " } });
      await expect(wrong.begin()).rejects.toMatchObject({ reason: "unsupportedLogSource" });
      expect(wrong.evidence().status).toBe("incomplete");
      await appendFile(state.path, "unfinished-private-message");
      await expect(state.capture.begin()).rejects.toMatchObject({ reason: "partialLogAtBegin" });
      await state.capture.end();
      await writeFile(state.path, "");
      await state.capture.begin();
      await appendFile(state.path, plan());
      await state.capture.end();
      expect(state.capture.evidence().status).toBe("complete");
      expect(JSON.stringify(state.capture.evidence())).not.toContain("unfinished-private-message");
    } finally { await state.capture.end(); await state.close(); }
  });

  it("refuses another window throughout asynchronous end and resets only after closure", async () => {
    const state = await fixture();
    try {
      await state.capture.begin(); await appendFile(state.path, plan());
      const ending = state.capture.end();
      await expect(state.capture.begin()).rejects.toMatchObject({ reason: "concurrentPlanCapture" });
      await ending;
      expect(state.capture.evidence().status).toBe("incomplete");
      await state.capture.begin(); await state.capture.end();
      expect(state.capture.evidence()).toMatchObject({ status: "complete", plans: [], failures: [] });
    } finally { await state.capture.end(); await state.close(); }
  });

  it("rejects invalid UTF-8 instead of substituting bytes into a plan", async () => {
    const state = await fixture();
    try {
      await state.capture.begin(); await appendFile(state.path, Buffer.from([0xc3, 0x28, 10]));
      await expect(state.capture.end()).rejects.toMatchObject({ _tag: "ServerPlanCaptureFailure",
        reason: "invalidLogEncoding", cause: expect.any(TypeError) });
      expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
      expect(state.capture.failures()[0]).toMatchObject({ cause: expect.any(TypeError) });
      await state.capture.begin(); await appendFile(state.path, plan()); await state.capture.end();
      expect(state.capture.evidence().status).toBe("complete");
    } finally { await state.capture.end(); await state.close(); }
  });

  it("releases a failed missing-source acquisition before a later valid window", async () => {
    const state = await fixture();
    try {
      await rm(state.path);
      await expect(state.capture.begin()).rejects.toMatchObject({ _tag: "ServerPlanCaptureFailure",
        reason: "logSourceStatFailed", cause: { code: "ENOENT" } });
      expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
      await writeFile(state.path, "");
      await state.capture.begin(); await appendFile(state.path, plan()); await state.capture.end();
      expect(state.capture.evidence().status).toBe("complete");
    } finally { await state.capture.end(); await state.close(); }
  });

  it("rejects invalid limits before opening any log", () => {
    for (const maxBytes of [0, -1, 0.5, Number.POSITIVE_INFINITY, 8 * 1024 * 1024 + 1]) {
      expect(() => createServerPlanCapture({ database, source: { path: "unused", prefix: SERVER_PLAN_LOG_PREFIX },
        limits: { maxBytes } })).toThrow();
    }
  });

  it("closes partial acquisition once and retains cleanup failure after the primary refusal", async () => {
    const state = await fixture();
    const cleanup = new Error("private-close-failure");
    try {
      await appendFile(state.path, "private-partial-message");
      fileBoundary.closeFailure = cleanup;
      await expect(state.capture.begin()).rejects.toMatchObject({ reason: "partialLogAtBegin" });
      const owned = fileBoundary.opened[0]!;
      expect(owned.closeCalls).toBe(1); expect(owned.handle.fd).toBe(-1);
      expect(state.capture.failures()).toMatchObject([
        { reason: "partialLogAtBegin" }, { _tag: "ServerPlanCaptureFailure", reason: "logCloseFailed", cause: cleanup },
      ]);
      expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      await state.capture.end(); expect(owned.closeCalls).toBe(1);
      fileBoundary.closeFailure = undefined;
      await writeFile(state.path, ""); await state.capture.begin(); await state.capture.end();
      expect(state.capture.evidence().status).toBe("complete");
    } finally { fileBoundary.closeFailure = undefined; await state.capture.end(); await state.close(); }
  });

  it("keeps a foreign read failure primary while closing its scope and retaining a close failure", async () => {
    const state = await fixture();
    const primary = new Error("private-read-failure"), cleanup = new Error("private-close-failure");
    try {
      await state.capture.begin();
      const owned = fileBoundary.opened[0]!;
      Object.assign(owned.handle, { read: async () => { throw primary; } });
      fileBoundary.closeFailure = cleanup;
      await expect(state.capture.end()).rejects.toMatchObject({ _tag: "ServerPlanCaptureFailure", reason: "logReadFailed", cause: primary });
      expect(owned.closeCalls).toBe(1); expect(owned.handle.fd).toBe(-1);
      expect(state.capture.failures()).toMatchObject([{ reason: "logReadFailed", cause: primary }, { reason: "logCloseFailed", cause: cleanup }]);
      expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
      expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      await state.capture.end(); expect(owned.closeCalls).toBe(1);
    } finally { fileBoundary.closeFailure = undefined; await state.capture.end(); await state.close(); }
  });

  it("rejects a successful read's close failure without declaring the observed window complete", async () => {
    const state = await fixture();
    const cleanup = new Error("private-close-failure");
    try {
      await state.capture.begin(); await appendFile(state.path, plan());
      fileBoundary.closeFailure = cleanup;
      await expect(state.capture.end()).rejects.toMatchObject({ _tag: "ServerPlanCaptureFailure", reason: "logCloseFailed", cause: cleanup });
      expect(state.capture.failures()).toMatchObject([{ reason: "logCloseFailed", cause: cleanup }]);
      expect(state.capture.evidence().status).toBe("incomplete");
      expect(state.capture.evidence().plans).toHaveLength(1);
      expect(fileBoundary.opened[0]!.closeCalls).toBe(1);
      expect(fileBoundary.opened[0]!.handle.fd).toBe(-1);
    } finally { fileBoundary.closeFailure = undefined; await state.capture.end(); await state.close(); }
  });

  it("keeps scope ownership busy until the asynchronous finalizer has finished", async () => {
    const state = await fixture();
    let release: (() => void) | undefined;
    try {
      await state.capture.begin(); await appendFile(state.path, plan());
      fileBoundary.closeGate = new Promise<void>(resolve => { release = resolve; });
      const ending = state.capture.end();
      await vi.waitFor(() => expect(fileBoundary.opened[0]!.closeCalls).toBe(1));
      await expect(state.capture.begin()).rejects.toMatchObject({ reason: "concurrentPlanCapture" });
      release!(); await ending;
      fileBoundary.closeGate = undefined;
      await state.capture.begin(); await state.capture.end();
      expect(state.capture.evidence()).toMatchObject({ status: "complete", failures: [] });
    } finally { release?.(); fileBoundary.closeGate = undefined; await state.capture.end(); await state.close(); }
  });

  it("retains no incomplete or malformed actual plan and preserves its original parse failure separately", async () => {
    const state = await fixture();
    try {
      await state.capture.begin();
      await appendFile(state.path, `${header()}LOG:  duration: 1.000 ms  plan:\n\t{ "Query Text": "private-malformed", "Plan":\n`);
      await expect(state.capture.end()).rejects.toMatchObject({ _tag: "ServerPlanCaptureFailure",
        reason: "invalidPlanJson", cause: expect.any(SyntaxError) });
      expect(state.capture.failures()[0]).toMatchObject({ reason: "invalidPlanJson", cause: expect.any(SyntaxError) });
      expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
      expect(JSON.stringify(state.capture.evidence())).not.toContain("private-malformed");
      await state.capture.begin();
      await appendFile(state.path, plan().slice(0, -1));
      await expect(state.capture.end()).rejects.toMatchObject({ reason: "partialLogAtEnd" });
      expect(state.capture.evidence().plans).toEqual([]);
    } finally { await state.capture.end(); await state.close(); }
  });

  for (const [name, bytes, reason] of [
    ["prefix", "2026-10-06 LOG:  duration: 1.000 ms  plan:\n", "logPrefixMismatch"],
    ["session", plan().replace("68abcdef.7b", "68abcdef.7c"), "logSessionPidMismatch"],
    ["header", `${header()}LOG:  duration: invalid ms  plan:\n`, "malformedPlanHeader"],
    ["continuation", "\tprivate-orphan\n", "orphanLogContinuation"],
  ] as const) {
    it(`fails closed on ${name} mismatch`, async () => {
      const state = await fixture();
      try {
        await state.capture.begin(); await appendFile(state.path, bytes);
        await expect(state.capture.end()).rejects.toMatchObject({ reason });
        expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
        expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      } finally { await state.capture.end(); await state.close(); }
    });
  }

  it("rejects plans without actual execution counts, invalid metrics and unknown operator names", async () => {
    const inputs = [plan({ "Actual Rows": null }), plan({ "Shared Read Blocks": -1 }),
      plan({ "Shared Read Blocks": Number.MAX_SAFE_INTEGER + 1 }), plan({ "Actual Total Time": "private-time" }),
      plan({ "Node Type": "private-extension-node" }), plan({}, { Triggers: [{ Time: -1, Calls: 1 }] }),
      plan({}, {}, database, "9223372036854775808")];
    for (const bytes of inputs) {
      const state = await fixture();
      try {
        await state.capture.begin(); await appendFile(state.path, bytes);
        await expect(state.capture.end()).rejects.toBeDefined();
        expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
        expect(JSON.stringify(state.capture.evidence())).not.toContain("private-");
      } finally { await state.capture.end(); await state.close(); }
    }
  });

  for (const [limits, bytes, reason] of [
    [{ maxBytes: 10 }, plan(), "logByteLimit"],
    [{ maxPlanBytes: 10 }, plan(), "planByteLimit"],
    [{ maxBlocks: 1 }, plan() + plan(), "logBlockLimit"],
    [{ maxPlans: 1 }, plan() + plan(), "planCountLimit"],
    [{ maxNodes: 1 }, plan({ Plans: [node()] }), "planNodeLimit"],
    [{ maxDepth: 1 }, plan({ Plans: [node()] }), "planDepthLimit"],
    [{ maxTriggers: 1 }, plan({}, { Triggers: [{ Time: 0, Calls: 1 }, { Time: 0, Calls: 1 }] }), "planTriggerLimit"],
  ] satisfies Array<[Partial<ServerPlanLimits>, string, string]>) {
    it(`enforces ${reason} without manufacturing complete evidence`, async () => {
      const state = await fixture(limits);
      try {
        await state.capture.begin(); await appendFile(state.path, bytes);
        await expect(state.capture.end()).rejects.toMatchObject({ reason });
        expect(state.capture.evidence().status).toBe("incomplete");
        expect(Result.isSuccess(Schema.decodeUnknownResult(ServerPlanEvidenceSchema)(state.capture.evidence()))).toBe(true);
      } finally { await state.capture.end(); await state.close(); }
    });
  }

  for (const action of ["truncate", "rewrite", "replace", "delete"] as const) {
    it(`rejects ${action} of the owned log and releases the failed window`, async () => {
      const state = await fixture();
      try {
        await state.capture.begin();
        if (action === "replace") { await rename(state.path, join(state.directory, "old.log")); await writeFile(state.path, plan()); }
        else if (action === "delete") await rm(state.path);
        else await writeFile(state.path, action === "truncate" ? "" : plan());
        await expect(state.capture.end()).rejects.toBeDefined();
        expect(state.capture.evidence()).toMatchObject({ status: "incomplete", plans: [] });
        await writeFile(state.path, "");
        await state.capture.begin(); await appendFile(state.path, plan()); await state.capture.end();
        expect(state.capture.evidence().status).toBe("complete");
      } finally { await state.capture.end(); await state.close(); }
    });
  }

  it("preserves a business rejection while closing the separate diagnostic window", async () => {
    const state = await fixture();
    const original = new Error("original business failure");
    try {
      await state.capture.begin();
      const run = async () => {
        try { await appendFile(state.path, plan()); throw original; }
        finally { await state.capture.end(); }
      };
      await expect(run()).rejects.toBe(original);
      expect(state.capture.evidence()).toMatchObject({ status: "complete" });
      expect(state.capture.evidence().plans).toHaveLength(1);
    } finally { await state.capture.end(); await state.close(); }
  });
});
