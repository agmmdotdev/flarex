import { createCyclePartition, type CycleReader, type CycleEvidence } from "../../../../packages/executor/test/performance/measurement/cycleAttribution";
import type { Identity, Edge, Request, Source } from "./evidence";
type Token = { site: string; edge: Edge; cycle: ReturnType<ReturnType<typeof createCyclePartition>["enter"]> };
type RecordedRequest = Request & { enabled: boolean; edges: Edge[]; identities: number; cycles: CycleEvidence | undefined; faults: string[] };

/** Diagnostic-only identity ledger. Input objects are never inspected: even
 * Proxies are only WeakMap keys. Strings use exact equality, not a lossy hash.
 * Identity is not authority, immutable ownership, or proof of redundant work. */
export function createRepresentationProbe(reader: CycleReader, reverse = false) {
  const requests: RecordedRequest[] = [];
  const sources: Source[] = [];
  let caller: string | undefined;
  let active: {
    info: Request; enabled: boolean; phase: string; next: number;
    objects: WeakMap<object, number>; strings: Map<string, number>; symbols: Map<symbol, number>; edges: Edge[];
    stack: Token[]; faults: string[]; partition: ReturnType<typeof createCyclePartition>;
  } | undefined;
  const fault = () => { if (active !== undefined && active.faults.length < 8) active.faults.push("representationObservation"); };
  // Charges ledger allocation and identity lookup separately. Boundary calls,
  // guards and JIT/GC disturbance still affect the experiment; this is not a
  // claim that the observer has been subtracted from production CPU.
  const bookkeeping = <A>(invoke: () => A): A => {
    const partition = active?.partition;
    const token = partition?.enter("observer-bookkeeping");
    try { return invoke(); }
    finally { if (token !== undefined) partition?.leave(token); }
  };
  const identity = (value: unknown): Identity => {
    if (active === undefined) return { kind: "undefined" };
    if (typeof value === "string") {
      let id = active.strings.get(value);
      if (id === undefined) { id = ++active.next; active.strings.set(value, id); }
      return { id, kind: "string", length: value.length };
    }
    if (typeof value === "bigint") return { kind: "bigint", value: String(value) };
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
      return { kind: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    if (typeof value === "symbol") {
      let id = active.symbols.get(value);
      if (id === undefined) { id = ++active.next; active.symbols.set(value, id); }
      return { kind: "symbol", id };
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") return { kind: "scalar", value };
    if (typeof value !== "object" && typeof value !== "function") return { kind: "undefined" };
    let id = active.objects.get(value);
    if (id === undefined) { id = ++active.next; active.objects.set(value, id); }
    return { id, kind: typeof value === "function" ? "function" : "object" };
  };
  const begin = (site: string, inputs: readonly unknown[]): Token | undefined => {
    if (!active?.enabled || active.faults.length > 0) return;
    // Recursive JSON encoding is one walk, not repeated whole-value encoding.
    if (active.stack.some(token => token.site === site)) return;
    try {
      if (active.edges.length >= 100_000 || active.next >= 200_000) throw Error("Identity ledger bound exceeded");
      const scope = active;
      const edge = bookkeeping(() => {
        const edge: Edge = { site, phase: scope.phase, parent: scope.stack.at(-1)?.site ?? null, caller, inputs: inputs.map(identity) };
        scope.edges.push(edge);
        return edge;
      });
      const token = { site, edge, cycle: active.partition.enter(active.phase + "|" + site) };
      active.stack.push(token);
      return token;
    } catch { fault(); return; }
  };
  const end = (token: Token | undefined) => {
    if (token === undefined || active === undefined) return;
    try {
      if (token.cycle !== undefined) active.partition.leave(token.cycle);
      if (active.stack.pop() !== token) throw Error("Unbalanced representation scope");
    } catch { fault(); }
  };
  const result = <A>(token: Token | undefined, value: A): A => {
    if (token !== undefined) { try { bookkeeping(() => { token.edge.output = identity(value); }); } catch { fault(); } }
    return value;
  };
  const api = {
    requests, sources, begin, end, result,
    atCall<A>(site: string, invoke: () => A): A {
      const previous = caller;
      caller = site;
      try { return invoke(); } finally { caller = previous; }
    },
    thrown(token: Token | undefined) { if (token !== undefined) token.edge.threw = true; },
    note(site: string, inputs: readonly unknown[]) {
      if (!active?.enabled) return;
      // A count-only async entry is never represented as synchronous CPU.
      try {
        if (active.edges.length >= 100_000) throw Error("Identity ledger bound exceeded");
        const scope = active;
        bookkeeping(() => scope.edges.push({ site: "async-entry:" + site, phase: scope.phase, parent: scope.stack.at(-1)?.site ?? null, inputs: inputs.map(identity) }));
      } catch { fault(); }
    },
    wrap<T extends (...args: never[]) => unknown>(site: string, fn: T): T {
      return new Proxy(fn, { apply(target, receiver, args: unknown[]) {
        const token = begin(site, args);
        try { return result(token, Reflect.apply(target, receiver, args)); }
        catch (cause) { api.thrown(token); throw cause; }
        finally { end(token); }
      } });
    },
    clone(site: string, ...args: Parameters<typeof structuredClone>): unknown {
      const token = begin("clone:" + site, args);
      try { return result(token, Reflect.apply(structuredClone, globalThis, args)); }
      catch (cause) { api.thrown(token); throw cause; }
      finally { end(token); }
    },
    async phase<A>(name: string, invoke: () => Promise<A>): Promise<A> {
      if (active === undefined) return invoke();
      const scope = active, previous = scope.phase;
      scope.phase = name;
      try { return await invoke(); } finally { scope.phase = previous; }
    },
    async request<A>(info: Request, invoke: () => Promise<A>): Promise<A> {
      if (active !== undefined) throw Error("Overlapping representation requests");
      const slot = ((info.index - 5) % 4 + 4) % 4;
      const enabled = info.kind === "diagnostic" && info.lane === "flarex" && ((slot === 0 || slot === 3) !== reverse);
      const partition = createCyclePartition(reader, "engine", enabled);
      const scope = { info, enabled, phase: "outside-phase", next: 0, objects: new WeakMap<object, number>(),
        strings: new Map<string, number>(), symbols: new Map<symbol, number>(), edges: [], stack: [], faults: [], partition };
      active = scope;
      partition.begin();
      try { return await invoke(); }
      finally {
        partition.end();
        if (active.stack.length > 0) fault();
        let cycles;
        try { cycles = partition.evidence(); } catch { fault(); }
        requests.push({ ...info, enabled, edges: scope.edges, identities: scope.next, cycles, faults: scope.faults });
        active = undefined;
      }
    },
  };
  return api;
}

declare global {
  var __representation: ReturnType<typeof createRepresentationProbe>;
}
