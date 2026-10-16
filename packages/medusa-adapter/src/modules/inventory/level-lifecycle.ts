import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { medusaLifecycle } from "../../repository/lifecycle";
import { orderNativeIdRows } from "../../repository/result";
import type { prepareScalarRepository } from "../../repository/scalar";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import type { captureInventoryMetadata } from "./schema";
import type { compileInventoryLevelContracts } from "./level-contracts";
import { decodeInventoryLevelDeletionIds } from "./delete-level-input";

export const InventoryLevelPhysicalDeletionIds = Schema.Array(ScalarId).check(Schema.isMaxLength(8));
export const decodeInventoryLevelPhysicalDeletionIds = commerceDecoder(InventoryLevelPhysicalDeletionIds, "invalidInput");
const decodePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: ScalarId })).check(Schema.isMaxLength(8)),
}), "unsupportedProfile");

type Bound = ReturnType<Result.Result.Success<ReturnType<typeof prepareScalarRepository>>["bind"]>;
type Frame = Effect.Success<ReturnType<typeof captureInventoryMetadata>>["frame"];
type Contracts = Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
type LevelTable = Frame["tables"][number];
type ManagedLevelLifecycleRepository = Pick<DAL.RepositoryService, "findAndCount" | "softDelete" | "restore">;
type PhysicalLevelLifecycleRepository = ManagedLevelLifecycleRepository & Pick<DAL.RepositoryService, "delete">;

/** The Level owner reuses managed lifecycle semantics across standalone and
 * batch roots. Only the batch admits the genuine retained physical inverse. */
export function inventoryLevelLifecycleRepository(bound: Bound, frame: Frame, table: LevelTable, contracts: Contracts,
  admission: "batch"): PhysicalLevelLifecycleRepository;
export function inventoryLevelLifecycleRepository(bound: Bound, frame: Frame, table: LevelTable, contracts: Contracts,
  admission?: "managed"): ManagedLevelLifecycleRepository;
export function inventoryLevelLifecycleRepository(bound: Bound, frame: Frame, table: LevelTable, contracts: Contracts,
  admission: "managed" | "batch" = "managed"): ManagedLevelLifecycleRepository & Partial<Pick<DAL.RepositoryService, "delete">> {
  const { bridge, events } = bound;
  const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
    bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
      const ids = yield* Effect.fromResult(decodeInventoryLevelDeletionIds(captured));
      const lifecycle = medusaLifecycle(current, { tables: frame.tables, entities: [{ table, model: "InventoryLevel" }] }, operation);
      const roots = yield* lifecycle.roots(table, [...new Set(ids)]);
      if (roots.length > 4) return yield* current.refuse(commerceError("unsupportedProfile"));
      for (const row of roots) yield* contracts.decodeStoredRow(row);
      const result = yield* (yield* lifecycle.plan(table, roots)).apply();
      for (const row of result.roots) yield* contracts.decodeStoredRow(row);
      if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
        return yield* current.refuse(commerceError("unadmittedEvent"));
      yield* events.cascades(result.cascades, shared, row => ({ entity: row,
        originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
      return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
    })));
  const findAndCount: DAL.RepositoryService["findAndCount"] = (input, shared) =>
    bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
      const result = yield* bound.find(current, captured, true);
      if (result.count === undefined || result.count > 4 || result.rows.length > 4 || result.count !== result.rows.length)
        return yield* current.refuse(commerceError("unsupportedProfile"));
      if (!Schema.is(Schema.JsonObject)(captured)) return yield* current.refuse(commerceError("unsupportedProfile"));
      const rows = [];
      for (const row of result.rows) {
        if (typeof row.id !== "string") return yield* current.refuse(commerceError("storedCorruption"));
        rows.push({ ...row, id: row.id });
      }
      return [structuredClone(orderNativeIdRows(rows, captured.where)), result.count] satisfies [object[], number];
    })));
  const physicalDelete: DAL.RepositoryService["delete"] = (input, shared) =>
    bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
      const selected = yield* Effect.fromResult(decodePhysicalSelection(captured));
      const ids = [...new Set(selected.$or.map(row => row.id))];
      const lifecycle = medusaLifecycle(current, { tables: frame.tables, entities: [{ table, model: "InventoryLevel" }] }, "delete");
      const roots = yield* lifecycle.roots(table, ids);
      if (roots.length > 8) return yield* current.refuse(commerceError("unsupportedProfile"));
      for (const row of roots) yield* contracts.decodeStoredRow(row);
      const plan = yield* lifecycle.plan(table, roots);
      if (frame.tables.some(candidate => candidate !== table && plan.rows(candidate).length !== 0))
        return yield* current.refuse(commerceError("unsupportedProfile"));
      const result = yield* plan.apply();
      // The actual generated internal service dispatches afterDelete from these
      // actual returned identities; the repository must not emit a second time.
      const deleted: string[] = [];
      for (const row of result.roots) {
        yield* contracts.decodeStoredRow(row);
        if (typeof row.id !== "string") return yield* current.refuse(commerceError("storedCorruption"));
        deleted.push(row.id);
      }
      return deleted;
    })));
  return { findAndCount, softDelete: lifecycle("softDelete"), restore: lifecycle("restore"),
    ...(admission === "batch" ? { delete: physicalDelete } : {}) };
}
