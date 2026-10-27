import { eq } from "drizzle-orm";
import { Effect, type Schema } from "effect";
import type { Definition } from "./definition.ts";
import { uniqueKeys } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { materialize, planMaterialization, type TableChanges } from "./materialization.ts";
import type { Command, Persistence } from "./persistence.ts";
import type { Dependency } from "./query.ts";
import type { UniqueObservation } from "./storage.ts";
import type { Root } from "./root.ts";
import { checkGroupDependencies } from "./settlement-observations.ts";
import * as tables from "./schema.ts";

export interface GroupCandidate extends TableChanges {
  readonly dependencies: readonly Dependency[];
  readonly uniques: readonly UniqueObservation[];
}

/** One projection of a framework root's frozen contract, used by the accepting
 * owner for one or multiple selected definitions. No child publication exists. */
export function frameworkCandidate(definition: Definition, frozen: Effect.Success<ReturnType<Root["freeze"]>>): GroupCandidate {
  return { definition, changes: frozen.changes, events: frozen.events, uniques: frozen.dependencies,
    dependencies: [...frozen.points, ...frozen.predicates] };
}

/** One accepting owner for selected tables. Framework groups retain direct CAS;
 * mixed groups additionally validate all participant snapshot dependencies.
 * Native bridges never receive this value or its parent command. */
export function createGroupStorage(persistence: Persistence) {
  const accept = Effect.fn("ExperimentGroupStorage.accept")(function* (command: Command, candidates: readonly GroupCandidate[], result: Schema.Json) {
    if (candidates.length === 0 || candidates.length > 16 || new Set(candidates.map(candidate => candidate.definition.table)).size !== candidates.length ||
      candidates.reduce((sum, candidate) => sum + candidate.changes.length, 0) > 256 ||
      candidates.reduce((sum, candidate) => sum + candidate.dependencies.length + candidate.uniques.length, 0) > 256 ||
      candidates.reduce((sum, candidate) => sum + candidate.events.length, 0) > 256 ||
      Buffer.byteLength(JSON.stringify(candidates.map(({ definition: _definition, ...data }) => data))) > 262144 ||
      Buffer.byteLength(JSON.stringify(result)) > 262144) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    const owned = candidates.map(({ definition, ...data }) => ({ definition, ...structuredClone(data) }));
    for (const candidate of owned) {
      if (new Set(candidate.changes.map(change => change.id)).size !== candidate.changes.length ||
        candidate.changes.some(change => change.body !== null && change.body.id !== change.id) ||
        candidate.events.some(event => !candidate.changes.some(change => change.id === event.document))) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      const points = new Set(candidate.dependencies.flatMap(dependency => dependency.kind === "point" ? [dependency.id] : []));
      if (candidate.definition.tableId !== null && (command.profile !== "mixed" || candidate.changes.some(change => !points.has(change.id)))) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      if (candidate.definition.tableId === null) {
        const observed = new Set(candidate.uniques.map(item => JSON.stringify({ field: item.field, key: item.key })));
        if (candidate.changes.some(change => change.body !== null && uniqueKeys(candidate.definition, change.body).some(key => !observed.has(JSON.stringify(key))))) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      }
    }
    const plan = planMaterialization(owned);
    const value = structuredClone(result);
    return yield* persistence.operation(async transaction => {
      const { stored, admitted } = await persistence.load(transaction, command);
      if (!admitted.owner || stored.profile !== "framework" && stored.profile !== "mixed" ||
        admitted.selection.length !== owned.length || owned.some(candidate => !admitted.selection.includes(candidate.definition))) throw new CoreError({ reason: "denied" });
      const [clock] = await transaction.select().from(tables.clocks).where(eq(tables.clocks.scope, stored.scope)).for("update");
      await persistence.checkTime(transaction, stored.expires);
      if (clock === undefined || !Number.isSafeInteger(clock.seq + 1)) throw new CoreError({ reason: "limit" });
      await checkGroupDependencies(transaction, stored.scope, stored.snapshot, owned, stored.profile);
      await materialize(transaction, stored.scope, command.id, clock.seq + 1, plan, value);
      return value;
    });
  });
  return {
    openFramework: (scope: string, request: string, digest: string, definitions: readonly Definition[], token: string) => persistence.openGroup("framework", scope, request, digest, definitions, token),
    openMixed: (scope: string, request: string, digest: string, definitions: readonly Definition[], token: string) => persistence.openGroup("mixed", scope, request, digest, definitions, token),
    accept, resolve: persistence.resolve, abort: persistence.abort,
  };
}
export type GroupStorage = ReturnType<typeof createGroupStorage>;
