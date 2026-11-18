import { Result } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
export const timestampMembershipOrigin = { kind: "synthetic", sourceId: "neutral-timestamp-membership" };
const origin = timestampMembershipOrigin;
export const timestampMembershipBoundary = "2026-10-29T10:00:00.000Z";
export const timestampMembershipSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "cohort", type: "text", nullable: false, default: { kind: "none" }, origin },
    ...["starts_at", "unindexed_at", "partial_at", "deleted_at"].map(columnId => ({ columnId, type: "timestamptz" as const,
      nullable: true, default: { kind: "none" as const }, origin })),
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "entry.starts", kind: "btree", columns: ["starts_at"], predicate: null, origin },
    { indexId: "entry.cohort", kind: "btree", columns: ["cohort"], predicate: null, origin },
    { indexId: "entry.partial", kind: "btree", columns: ["partial_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
    { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  ], constraints: [], relationships: [] }], capabilities: [] }));
export const timestampMembershipQuery = <Predicate>(predicate: Predicate) => ({ fields: ["id"], includeIdentities: true,
  order: { column: "id", direction: "asc" }, predicate });
