import { Cause, Data, Effect, Exit, Result, Schema, Scope } from "effect";
import { open, lstat, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute } from "node:path";
import { TextDecoder } from "node:util";
import { describeFailure, FailureEvidenceSchema, type FailureEvidence } from "../failure";

export const SERVER_PLAN_LOG_PREFIX = "FXPLAN[%p][%d][%c][%Q]";
export interface ServerPlanLogSource { readonly path: string; readonly prefix: string }

const finite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const bounded = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));
export const ServerPlanLimitsSchema = Schema.Struct({ maxBytes: bounded(8 * 1024 * 1024),
  maxPlanBytes: bounded(512 * 1024), maxBlocks: bounded(20_000), maxPlans: bounded(4096),
  maxNodes: bounded(50_000), maxDepth: bounded(128), maxTriggers: bounded(2048) });
export type ServerPlanLimits = typeof ServerPlanLimitsSchema.Type;
export const serverPlanLimits: ServerPlanLimits = Object.freeze({ maxBytes: 8 * 1024 * 1024,
  maxPlanBytes: 512 * 1024, maxBlocks: 20_000, maxPlans: 4096, maxNodes: 50_000, maxDepth: 128, maxTriggers: 2048 });

const nodeType = Schema.Literals(["Result", "ProjectSet", "ModifyTable", "Append", "Merge Append", "Recursive Union",
  "BitmapAnd", "BitmapOr", "Seq Scan", "Sample Scan", "Index Scan", "Index Only Scan", "Bitmap Index Scan",
  "Bitmap Heap Scan", "Tid Scan", "Tid Range Scan", "Subquery Scan", "Function Scan", "Table Function Scan",
  "Values Scan", "CTE Scan", "Named Tuplestore Scan", "WorkTable Scan", "Foreign Scan", "Custom Scan",
  "Nested Loop", "Merge Join", "Hash Join", "Materialize", "Memoize", "Sort", "Incremental Sort", "Group",
  "Aggregate", "WindowAgg", "Unique", "Gather", "Gather Merge", "Hash", "SetOp", "LockRows", "Limit"]);
const metricNames = new Set([
  "Startup Cost", "Total Cost", "Plan Rows", "Plan Width", "Actual Startup Time", "Actual Total Time", "Actual Rows", "Actual Loops",
  "Rows Removed by Filter", "Rows Removed by Join Filter", "Rows Removed by Index Recheck", "Heap Fetches",
  "Exact Heap Blocks", "Lossy Heap Blocks", "Shared Hit Blocks", "Shared Read Blocks", "Shared Dirtied Blocks", "Shared Written Blocks",
  "Local Hit Blocks", "Local Read Blocks", "Local Dirtied Blocks", "Local Written Blocks", "Temp Read Blocks", "Temp Written Blocks",
  "I/O Read Time", "I/O Write Time", "Shared I/O Read Time", "Shared I/O Write Time", "Local I/O Read Time", "Local I/O Write Time",
  "Temp I/O Read Time", "Temp I/O Write Time", "Sort Space Used", "Hash Buckets", "Original Hash Buckets", "Hash Batches",
  "Original Hash Batches", "Peak Memory Usage", "Workers Planned", "Workers Launched", "Cache Hits", "Cache Misses", "Cache Evictions", "Cache Overflows",
]);
const metricName = Schema.String.check(Schema.makeFilter(value => metricNames.has(value) ? undefined : "Unknown plan metric"));
const PlanNodeSchema = Schema.Struct({ id: count, parentId: Schema.NullOr(count), nodeType,
  metrics: Schema.Record(metricName, finite) });
const QueryIdentifierSchema = Schema.String.check(Schema.makeFilter(value => {
  if (!/^(?:0|-?[1-9]\d{0,18})$/.test(value)) return "Invalid query identifier decimal";
  const integer = BigInt(value);
  return integer >= -(1n << 63n) && integer <= (1n << 63n) - 1n ? undefined : "Query identifier exceeds signed int64";
}));
const HeaderSchema = Schema.Struct({ backendPid: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 })),
  database: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/)),
  sessionId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{1,8}\.[a-f0-9]{1,8}$/)),
  queryId: QueryIdentifierSchema });
const ActualPlanSchema = Schema.Struct({ ordinal: count, header: HeaderSchema, queryId: Schema.NullOr(QueryIdentifierSchema), durationMs: finite,
  nodes: Schema.Array(PlanNodeSchema), triggers: Schema.Array(Schema.Struct({ ordinal: count, timeMs: Schema.NullOr(finite), calls: count })) });
export const ServerPlanEvidenceSchema = Schema.Struct({ status: Schema.Literals(["complete", "incomplete"]),
  coverage: Schema.Literal("observedLogWindowOnly"), flushCompleteness: Schema.Literal("unproven"),
  limits: ServerPlanLimitsSchema,
  window: Schema.Struct({ startOffsetBytes: Schema.NullOr(count), endOffsetBytes: Schema.NullOr(count), readBytes: count }),
  plans: Schema.Array(ActualPlanSchema), ignoredBlocks: count, foreignDatabasePlans: count,
  failures: Schema.Array(FailureEvidenceSchema),
}).check(Schema.makeFilter(value => value.plans.length > value.limits.maxPlans || value.window.readBytes > value.limits.maxBytes ||
  value.plans.reduce((sum, plan) => sum + plan.nodes.length, 0) > value.limits.maxNodes ||
  value.plans.reduce((sum, plan) => sum + plan.triggers.length, 0) > value.limits.maxTriggers
  ? "Plan evidence exceeds configured retention limits" : undefined));
export type ServerPlanEvidence = typeof ServerPlanEvidenceSchema.Type;
type ActualPlan = typeof ActualPlanSchema.Type;
type PlanNode = typeof PlanNodeSchema.Type;

class ServerPlanCaptureFailure extends Data.TaggedError("ServerPlanCaptureFailure")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}
const issue = (reason: string, cause?: unknown) => new ServerPlanCaptureFailure({ reason,
  ...(cause === undefined ? {} : { cause }) });
type PlanParseFailure = ServerPlanCaptureFailure | Schema.SchemaError;
const fileOperation = <A>(reason: string, run: () => Promise<A>) => Effect.tryPromise({
  try: run, catch: cause => issue(reason, cause),
});
const rejection = <E>(cause: Cause.Cause<E>): E | Cause.Cause<E> => {
  const first = cause.reasons[0];
  return cause.reasons.length === 1 && first !== undefined && Cause.isFailReason(first) ? first.error : cause;
};
const decodeLimits = Schema.decodeUnknownSync(ServerPlanLimitsSchema, { onExcessProperty: "error" });
const decodeHeader = Schema.decodeUnknownResult(HeaderSchema, { onExcessProperty: "error" });
const decodeFinite = Schema.decodeUnknownResult(finite);
const decodeCount = Schema.decodeUnknownResult(count);
const decodeQueryIdentifier = Schema.decodeUnknownResult(QueryIdentifierSchema);
const SourcePlanSchema = Schema.Struct({ Plan: Schema.Unknown, Triggers: Schema.optional(Schema.Array(Schema.Unknown)) });
const SourceNodeSchema = Schema.StructWithRest(Schema.Struct({ "Node Type": nodeType,
  "Actual Rows": finite, "Actual Loops": finite, Plans: Schema.optional(Schema.Array(Schema.Unknown)) }), [Schema.Record(Schema.String, Schema.Unknown)]);
const decodeSourcePlan = Schema.decodeUnknownResult(SourcePlanSchema);
const decodeSourceNode = Schema.decodeUnknownResult(SourceNodeSchema);
// PostgreSQL 18 report_triggers emits Calls regardless of timing, and emits Time
// only when timing is enabled. Keep the trigger and represent absent time honestly.
const decodeTrigger = Schema.decodeUnknownResult(Schema.Struct({ Time: Schema.optional(finite), Calls: count }));

/** Scan an already syntax-validated, byte-bounded JSON object. Only direct-root
 * keys qualify; JSON.parse alone loses both integer precision and duplicate keys.
 * This preserves one numeric token, not a second JSON grammar or plan decoder. */
function capturePlanQueryId(raw: string): Result.Result<string | null, ServerPlanCaptureFailure> {
  return Result.gen(function* () {
    let depth = 0, seen = false;
    let queryId: string | null = null;
    for (let offset = 0; offset < raw.length;) {
      const char = raw[offset];
      if (char === "{" || char === "[") { depth++; offset++; continue; }
      if (char === "}" || char === "]") { depth--; offset++; continue; }
      if (char !== '"') { offset++; continue; }
      const start = offset++;
      while (offset < raw.length) {
        if (raw[offset] === "\\") { offset += 2; continue; }
        if (raw[offset++] === '"') break;
      }
      let colon = offset;
      while (/\s/.test(raw[colon] ?? "")) colon++;
      if (depth !== 1 || raw[colon] !== ":") continue;
      const key = yield* Result.try({ try: (): unknown => JSON.parse(raw.slice(start, offset)),
        catch: cause => issue("invalidPlanJson", cause) });
      if (key !== "Query Identifier") continue;
      if (seen) return yield* Result.fail(issue("duplicatePlanQueryId"));
      seen = true;
      let valueStart = colon + 1;
      while (/\s/.test(raw[valueStart] ?? "")) valueStart++;
      let valueEnd = valueStart;
      while (valueEnd < raw.length && !/[\s,}]/.test(raw[valueEnd] ?? "")) valueEnd++;
      queryId = yield* decodeQueryIdentifier(raw.slice(valueStart, valueEnd))
        .pipe(Result.mapError(cause => issue("invalidPlanQueryId", cause)));
    }
    return queryId;
  });
}

/** PostgreSQL 18 auto_explain.c emits one JSON object. elog.c prefixes the
 * message once and inserts a tab after every embedded newline. Keep SQL text,
 * expressions, names and parameters outside evidence; retain the plan's exact
 * query ID separately from the backend log-prefix query context. */
function sanitizePlan(raw: string, header: ActualPlan["header"], durationMs: number, ordinal: number,
  limits: ServerPlanLimits, retained: { nodes: number; triggers: number }): Result.Result<ActualPlan, PlanParseFailure> {
  return Result.gen(function* () {
    const json = yield* Result.try({ try: (): unknown => JSON.parse(raw), catch: cause => issue("invalidPlanJson", cause) });
    const source = yield* decodeSourcePlan(json);
    const queryId = yield* capturePlanQueryId(raw);
    const nodes: PlanNode[] = [];
    const visit = (input: unknown, parentId: number | null, depth: number): Result.Result<void, PlanParseFailure> => Result.gen(function* () {
      if (depth > limits.maxDepth) return yield* Result.fail(issue("planDepthLimit"));
      if (retained.nodes + nodes.length >= limits.maxNodes) return yield* Result.fail(issue("planNodeLimit"));
      const sourceNode = yield* decodeSourceNode(input);
      const metrics: Record<string, number> = {};
      for (const name of metricNames) {
        if (!(name in sourceNode)) continue;
        const value = yield* (name.endsWith(" Blocks") || name === "Plan Width" || name === "Heap Fetches" ||
          name === "Workers Planned" || name === "Workers Launched" || name.startsWith("Cache ") || name.includes("Buckets") || name.includes("Batches")
          ? decodeCount(sourceNode[name]) : decodeFinite(sourceNode[name]));
        metrics[name] = value;
      }
      const id = nodes.length;
      nodes.push({ id, parentId, nodeType: sourceNode["Node Type"], metrics });
      for (const child of sourceNode.Plans ?? []) yield* visit(child, id, depth + 1);
    });
    yield* visit(source.Plan, null, 1);
    const triggers: ActualPlan["triggers"][number][] = [];
    for (const input of source.Triggers ?? []) {
      if (retained.triggers + triggers.length >= limits.maxTriggers) return yield* Result.fail(issue("planTriggerLimit"));
      const trigger = yield* decodeTrigger(input).pipe(Result.mapError(cause => issue("invalidTriggerStats", cause)));
      triggers.push({ ordinal: triggers.length, timeMs: trigger.Time ?? null, calls: trigger.Calls });
    }
    return { ordinal, header, queryId, durationMs, nodes, triggers };
  });
}

const sameFile = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
const readExactly = Effect.fn("ServerPlanCapture.readExactly")(function* (file: FileHandle, offset: number,
  size: number): Effect.fn.Return<Buffer, ServerPlanCaptureFailure> {
  const buffer = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const result = yield* fileOperation("logReadFailed", () => file.read(buffer, read, size - read, offset + read));
    if (result.bytesRead === 0) return yield* Effect.fail(issue("logTruncatedDuringRead"));
    read += result.bytesRead;
  }
  return buffer;
});

/** One diagnostic file lifetime, supplied only by trusted cluster composition.
 * Methods reject their own faults; the server observer keeps them separate from
 * business rejection. Completeness refers only to parsed bytes, never flushing
 * or the coverage of statements, failed executions, utilities or other files. */
export function createServerPlanCapture(input: Readonly<{ database: string; source: ServerPlanLogSource;
  limits?: Partial<ServerPlanLimits> }>) {
  const limits = decodeLimits({ ...serverPlanLimits, ...input.limits });
  let state: "new" | "opening" | "open" | "ending" | "closed" = "new";
  let windowScope: Scope.Closeable | undefined;
  let closeFailure: ServerPlanCaptureFailure | undefined;
  let file: FileHandle | undefined;
  let identity: Stats | undefined;
  let anchor: Buffer | undefined;
  let anchorOffset = 0;
  let startOffsetBytes: number | null = null, endOffsetBytes: number | null = null, readBytes = 0;
  let ignoredBlocks = 0, foreignDatabasePlans = 0;
  const plans: ActualPlan[] = [];
  const failures: unknown[] = [];
  const failureEvidence: FailureEvidence[] = [];
  const retained = { nodes: 0, triggers: 0 };
  const fail = (stage: string, cause: unknown) => { failures.push(cause); failureEvidence.push(describeFailure(stage, cause)); };
  const releaseFile = Effect.fn("ServerPlanCapture.releaseFile")((owned: FileHandle) =>
    fileOperation("logCloseFailed", () => owned.close()).pipe(Effect.catch(cause => Effect.sync(() => {
      closeFailure = cause; fail("planLogClose", cause);
    }))));
  const closeWindow = Effect.fn("ServerPlanCapture.closeWindow")(function* (scope: Scope.Closeable,
    exit: Exit.Exit<void, PlanParseFailure>): Effect.fn.Return<void, ServerPlanCaptureFailure> {
    yield* Scope.close(scope, exit);
    if (closeFailure !== undefined) return yield* Effect.fail(closeFailure);
  });
  const recordClose = (exit: Exit.Exit<void, ServerPlanCaptureFailure>) => {
    if (Exit.isFailure(exit)) {
      const cause = rejection(exit.cause);
      if (cause !== closeFailure) fail("planLogClose", cause);
    }
  };
  const resetClosed = () => {
    file = undefined; anchor = undefined; identity = undefined; windowScope = undefined;
    state = "closed";
  };

  const parseWindow = (text: string): Result.Result<void, PlanParseFailure> => Result.gen(function* () {
    let blocks = 0;
    let current: { header: ActualPlan["header"] | undefined; durationMs: number | undefined; lines: string[]; bytes: number } | undefined;
    const finish = (): Result.Result<void, PlanParseFailure> => Result.gen(function* () {
      if (current === undefined) return;
      if (current.header === undefined || current.durationMs === undefined) { ignoredBlocks++; return; }
      if (current.header.database !== input.database) { foreignDatabasePlans++; return; }
      if (plans.length >= limits.maxPlans) return yield* Result.fail(issue("planCountLimit"));
      const raw = current.lines.join("\n");
      if (Buffer.byteLength(raw, "utf8") > limits.maxPlanBytes) return yield* Result.fail(issue("planByteLimit"));
      const plan = yield* sanitizePlan(raw, current.header, current.durationMs, plans.length, limits, retained);
      retained.nodes += plan.nodes.length; retained.triggers += plan.triggers.length;
      plans.push(plan);
    });
    for (let offset = 0; offset < text.length;) {
      const next = text.indexOf("\n", offset);
      if (next < 0) return yield* Result.fail(issue("partialLogAtEnd"));
      const line = text.slice(offset, next);
      offset = next + 1;
      if (line.startsWith("\t")) {
        if (current === undefined) return yield* Result.fail(issue("orphanLogContinuation"));
        if (current.header?.database === input.database) {
          current.bytes += Buffer.byteLength(line, "utf8");
          if (current.bytes > limits.maxPlanBytes) return yield* Result.fail(issue("planByteLimit"));
          current.lines.push(line.slice(1));
        }
        continue;
      }
      yield* finish(); current = undefined;
      if (++blocks > limits.maxBlocks) return yield* Result.fail(issue("logBlockLimit"));
      const matched = /^FXPLAN\[(\d{1,10})\]\[([A-Za-z0-9_]*)\]\[([a-f0-9]{1,8}\.[a-f0-9]{1,8})\]\[(-?\d{1,19})?\]([A-Z0-9]+): {1,2}(.*)\r?$/.exec(line);
      if (matched === null) return yield* Result.fail(issue("logPrefixMismatch"));
      const duration = matched[5] === "LOG" ? /^duration: (\d+(?:\.\d+)?) ms {1,2}plan:\r?$/.exec(matched[6] ?? "") : null;
      if (duration === null) {
        if ((matched[6] ?? "").includes("plan:")) return yield* Result.fail(issue("malformedPlanHeader"));
        current = { header: undefined, durationMs: undefined, lines: [], bytes: 0 }; continue;
      }
      const header = yield* decodeHeader({ backendPid: Number(matched[1]), database: matched[2], sessionId: matched[3], queryId: matched[4] });
      if (BigInt(`0x${header.sessionId.split(".")[1]}`) !== BigInt(header.backendPid)) return yield* Result.fail(issue("logSessionPidMismatch"));
      const durationMs = yield* decodeFinite(Number(duration[1]));
      current = { header, durationMs, lines: [], bytes: 0 };
    }
    yield* finish();
  });

  const acquireWindow = Effect.fn("ServerPlanCapture.acquireWindow")(function* (): Effect.fn.Return<void,
    ServerPlanCaptureFailure, Scope.Scope> {
    if (input.source.prefix !== SERVER_PLAN_LOG_PREFIX || !isAbsolute(input.source.path) ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(input.database)) return yield* Effect.fail(issue("unsupportedLogSource"));
    const pathIdentity = yield* fileOperation("logSourceStatFailed", () => lstat(input.source.path));
    if (!pathIdentity.isFile()) return yield* Effect.fail(issue("nonRegularLogSource"));
    // Registration is atomic with acquisition, before stat, identity and anchor
    // validation. The caller retains this explicit Scope until end or failed begin.
    file = yield* Effect.acquireRelease(fileOperation("logOpenFailed", () => open(input.source.path, "r")), releaseFile);
    const owned = file;
    identity = yield* fileOperation("logFileStatFailed", () => owned.stat());
    if (!sameFile(pathIdentity, identity) || !identity.isFile() || !Number.isSafeInteger(identity.size))
      return yield* Effect.fail(issue("logSourceChanged"));
    startOffsetBytes = identity.size;
    anchorOffset = Math.max(0, identity.size - 256);
    anchor = yield* readExactly(owned, anchorOffset, identity.size - anchorOffset);
    if (anchor.length > 0 && anchor.at(-1) !== 10) return yield* Effect.fail(issue("partialLogAtBegin"));
  });
  const readWindow = Effect.fn("ServerPlanCapture.readWindow")(function* (owned: FileHandle,
    initial: Stats, start: number, previousAnchor: Buffer): Effect.fn.Return<void, PlanParseFailure> {
    const pathIdentity = yield* fileOperation("logSourceStatFailed", () => lstat(input.source.path));
    const observed = yield* fileOperation("logFileStatFailed", () => owned.stat());
    if (!pathIdentity.isFile() || !sameFile(initial, pathIdentity) || !sameFile(initial, observed))
      return yield* Effect.fail(issue("logSourceChanged"));
    if (!Number.isSafeInteger(observed.size) || observed.size < start) return yield* Effect.fail(issue("logTruncated"));
    endOffsetBytes = observed.size;
    const available = endOffsetBytes - start;
    if (available > limits.maxBytes) return yield* Effect.fail(issue("logByteLimit"));
    const currentAnchor = yield* readExactly(owned, anchorOffset, previousAnchor.length);
    if (!previousAnchor.equals(currentAnchor)) return yield* Effect.fail(issue("logAnchorChanged"));
    const bytes = yield* readExactly(owned, start, available);
    readBytes = bytes.length;
    if (bytes.length > 0 && bytes.at(-1) !== 10) return yield* Effect.fail(issue("partialLogAtEnd"));
    const afterRead = yield* fileOperation("logFileStatFailed", () => owned.stat());
    const pathAfterRead = yield* fileOperation("logSourceStatFailed", () => lstat(input.source.path));
    if (afterRead.size !== observed.size || !pathAfterRead.isFile() || !sameFile(initial, pathAfterRead))
      return yield* Effect.fail(issue("logChangedDuringRead"));
    const text = yield* Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: cause => issue("invalidLogEncoding", cause) });
    yield* Effect.fromResult(parseWindow(text));
  });
  const beginWindow = Effect.fn("ServerPlanCapture.beginWindow")(function* (): Effect.fn.Return<void, PlanParseFailure> {
    if (state !== "new" && state !== "closed") {
      const cause = issue("concurrentPlanCapture"); fail("planLogBegin", cause); return yield* Effect.fail(cause);
    }
    plans.length = 0; failures.length = 0; failureEvidence.length = 0;
    ignoredBlocks = 0; foreignDatabasePlans = 0;
    startOffsetBytes = null; endOffsetBytes = null; readBytes = 0;
    retained.nodes = 0; retained.triggers = 0; closeFailure = undefined;
    state = "opening";
    const scope = yield* Scope.make();
    windowScope = scope;
    const acquired = yield* Effect.exit(Scope.provide(acquireWindow(), scope));
    if (Exit.isFailure(acquired)) {
      fail("planLogBegin", rejection(acquired.cause));
      const closed = yield* Effect.exit(closeWindow(scope, acquired));
      recordClose(closed); resetClosed();
      return yield* Effect.failCause(acquired.cause);
    }
    state = "open";
  }, Effect.uninterruptible);
  const endWindow = Effect.fn("ServerPlanCapture.endWindow")(function* (): Effect.fn.Return<void, PlanParseFailure> {
    if (state === "closed") return;
    if (state !== "open" || file === undefined || identity === undefined || startOffsetBytes === null ||
      anchor === undefined || windowScope === undefined) {
      const cause = issue("planCaptureNotStarted"); fail("planLogEnd", cause); return yield* Effect.fail(cause);
    }
    state = "ending";
    const read = yield* Effect.exit(readWindow(file, identity, startOffsetBytes, anchor));
    if (Exit.isFailure(read)) fail("planLogEnd", rejection(read.cause));
    const closed = yield* Effect.exit(closeWindow(windowScope, read));
    recordClose(closed); resetClosed();
    if (Exit.isFailure(read)) return yield* Effect.failCause(read.cause);
    if (Exit.isFailure(closed)) return yield* Effect.failCause(closed.cause);
  }, Effect.uninterruptible);
  const runBoundary = async (operation: Effect.Effect<void, PlanParseFailure>): Promise<void> => {
    const exit = await Effect.runPromiseExit(operation);
    Exit.match(exit, { onSuccess: () => undefined, onFailure: cause => { throw rejection(cause); } });
  };
  return {
    begin: (): Promise<void> => runBoundary(beginWindow()),
    end: (): Promise<void> => runBoundary(endWindow()),
    evidence(): ServerPlanEvidence {
      return { status: state === "closed" && failures.length === 0 ? "complete" : "incomplete",
        coverage: "observedLogWindowOnly", flushCompleteness: "unproven", limits,
        window: { startOffsetBytes, endOffsetBytes, readBytes }, plans: plans.map(plan => ({ ...plan,
          header: { ...plan.header }, nodes: plan.nodes.map(node => ({ ...node, metrics: { ...node.metrics } })),
          triggers: plan.triggers.map(trigger => ({ ...trigger })) })),
        ignoredBlocks, foreignDatabasePlans, failures: failureEvidence.map(failure => ({ ...failure,
          tokens: [...failure.tokens], reasons: failure.reasons.map(reason => ({ ...reason,
            tokens: [...reason.tokens], reasonPath: [...reason.reasonPath] })) })) };
    },
    failures: (): readonly unknown[] => [...failures],
  };
}
