import { PgliteSession } from "drizzle-orm/pglite/session";
import { NodePgSession } from "drizzle-orm/node-postgres/session";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core";

/** Test observation over the original native preparation and result mapper.
 * Positive headers always come from the real database. The one corruption seam
 * adds a body to that actual response before the unchanged mapper consumes it. */
export function observeFiniteApplicationAdmissionDriver() {
  const originalPGlite = Object.getOwnPropertyDescriptor(PgliteSession.prototype, "prepareQuery");
  const originalPostgres = Object.getOwnPropertyDescriptor(NodePgSession.prototype, "prepareQuery");
  if (originalPGlite === undefined || originalPostgres === undefined) throw new Error("Missing native capture preparation");
  const pglite = PgliteSession.prototype.prepareQuery;
  const postgres = NodePgSession.prototype.prepareQuery;
  let active = false;
  let corruptNextBody = false;
  let corruptReplacementBytes = false;
  let lifecycleFault: unknown;
  const captures: Array<Readonly<{ sql: string; tableId: unknown; indexDefinitionId: unknown; uniqueDefinitionId: unknown; rawRows: number }>> = [];
  const wrap = <T extends PreparedQueryConfig>(args: Parameters<typeof pglite<T>>) => {
    const fields = args[1], mapper = args[4];
    if (!active || fields === undefined || mapper === undefined || !args[0].sql.includes("fx_accept_finite_storage_capture")) return;
    const raw = fields.filter(field => field.path[0] === "raw");
    const headerOnly = raw.length === 1 && raw[0]?.path[1] === "ordinal";
    if (!headerOnly) throw new Error("Known/replayed operation entered a business capture body");
    const marker = fields.findIndex(field => field.path[0] === "storagePresent");
    const ordinal = fields.findIndex(field => field.path[0] === "raw" && field.path[1] === "ordinal");
    const reason = fields.findIndex(field => field.path.length === 1 && field.path[0] === "reason");
    if (marker < 0 || ordinal < 0 || reason < 0) throw new Error("Missing native header layout");
    let entry: typeof captures[number] | undefined;
    args[4] = rows => {
      if (entry === undefined) throw new Error("Native mapper ran without its actual bindings");
      captures.push({ ...entry, rawRows: rows.filter(row => row[marker] === true).length });
      if (lifecycleFault !== undefined && rows[0]?.[reason] === "accepted") {
        const lifecycle = fields.findIndex(field => field.path.length === 1 && field.path[0] === "refusedLifecycle");
        const corrupted = rows.map(row => [...row]);
        if (lifecycle < 0 || corrupted[0] === undefined) throw new Error("Missing genuine lifecycle scalar projection");
        corrupted[0][reason] = "lifecycleChanged";
        corrupted[0][lifecycle] = lifecycleFault;
        lifecycleFault = undefined;
        return mapper(corrupted);
      }
      if (corruptNextBody && rows[0]?.[reason] === "accepted") {
        corruptNextBody = false;
        const corrupted = rows.map(row => [...row]);
        const first = corrupted[0];
        if (first === undefined) throw new Error("Missing real accepted header");
        first[marker] = true;
        first[ordinal] = 0;
        return mapper(corrupted);
      }
      if (corruptReplacementBytes && rows[0]?.[reason] === "attemptReplaced") {
        corruptReplacementBytes = false;
        const bytes = fields.findIndex(field => field.path[0] === "frontier" && field.path[1] === "finiteAttemptBytes");
        const corrupted = rows.map(row => [...row]);
        if (bytes < 0 || corrupted[0] === undefined) throw new Error("Missing genuine replacement frontier bytes");
        corrupted[0][bytes] = new Uint8Array([0]);
        return mapper(corrupted);
      }
      return mapper(rows);
    };
    return (parameters: unknown[]) => {
      const bindings = parameters[0];
      if (typeof bindings !== "object" || bindings === null) throw new Error("Missing real native parameter bindings");
      entry = { sql: args[0].sql, tableId: Reflect.get(bindings, "tableId"),
        indexDefinitionId: Reflect.get(bindings, "indexDefinitionId"), uniqueDefinitionId: Reflect.get(bindings, "uniqueDefinitionId"), rawRows: 0 };
    };
  };
  PgliteSession.prototype.prepareQuery = function <T extends PreparedQueryConfig = PreparedQueryConfig>(...args: Parameters<typeof pglite<T>>) {
    const observe = wrap(args), prepared = (pglite<T>).apply(this, args);
    return observe === undefined ? prepared : new Proxy(prepared, { get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return new Proxy(target.execute, { apply(execute, _receiver, parameters: unknown[]) {
        observe(parameters);
        return Reflect.apply(execute, target, parameters);
      } });
    } });
  };
  NodePgSession.prototype.prepareQuery = function <T extends PreparedQueryConfig = PreparedQueryConfig>(...args: Parameters<typeof postgres<T>>) {
    const observe = wrap(args), prepared = (postgres<T>).apply(this, args);
    return observe === undefined ? prepared : new Proxy(prepared, { get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return new Proxy(target.execute, { apply(execute, _receiver, parameters: unknown[]) {
        observe(parameters);
        return Reflect.apply(execute, target, parameters);
      } });
    } });
  };
  return { captures,
    begin(corruptBody = false, corruptReplacement = false, refusedLifecycle?: unknown) {
      captures.length = 0; corruptNextBody = corruptBody; corruptReplacementBytes = corruptReplacement;
      lifecycleFault = refusedLifecycle; active = true;
    },
    stop() { active = false; },
    restore() { Object.defineProperty(PgliteSession.prototype, "prepareQuery", originalPGlite);
      Object.defineProperty(NodePgSession.prototype, "prepareQuery", originalPostgres); },
  };
}
