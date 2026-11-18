import { Result } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export const numberMembershipOrigin = { kind: "synthetic", sourceId: "neutral-number-membership" };
const origin = numberMembershipOrigin;
export const numberMembershipSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  capabilities: [], tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "cohort", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "version", type: "integer", nullable: false, default: { kind: "none" }, origin },
    { columnId: "measure", type: "doublePrecision", nullable: true, default: { kind: "none" }, origin },
    { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
    { columnId: "real_measure", type: "real", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: "entry.cohort", kind: "btree", columns: ["cohort"], predicate: null, origin }],
  constraints: [], relationships: [] }] }));
