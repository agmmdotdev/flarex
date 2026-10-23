import { Result } from "effect";
import { planScalarCreateBatch } from "@medusajs/utils/dal/create-planning";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

/** Authenticate positional native create aliases before comparing the unique
 * persistence/event cohort. Only repeated explicit input identities may alias;
 * every generated identity and every full aliased DTO remains independently
 * accounted for. Defaults belong after the native nullish scalar merge. */
export function correlateScalarCreateReceipt<Row extends JsonObject & { readonly id: string }>(
  inputs: readonly JsonObject[], results: readonly Row[],
) {
  return Result.gen(function* () {
    if (inputs.length !== results.length) return yield* Result.fail(commerceError("receiptMismatch"));
    const explicit = new Set(inputs.flatMap(input => typeof input.id === "string" ? [input.id] : []));
    const generated = new Set<string>(), sources: Array<JsonObject & { id: string }> = [];
    for (const [index, input] of inputs.entries()) {
      const result = results[index];
      if (result === undefined || input.id !== undefined && input.id !== result.id)
        return yield* Result.fail(commerceError("receiptMismatch"));
      if (input.id === undefined) {
        if (explicit.has(result.id) || generated.has(result.id)) return yield* Result.fail(commerceError("receiptMismatch"));
        generated.add(result.id);
      }
      sources.push({ ...input, id: result.id });
    }
    const plan = planScalarCreateBatch(sources), canonical: Row[] = [];
    for (const [index, position] of plan.positions.entries()) {
      const result = results[index];
      if (result === undefined) return yield* Result.fail(commerceError("receiptMismatch"));
      const prior = canonical[position];
      if (prior === undefined) canonical.push(result);
      else if (!jsonEqual(prior, result)) return yield* Result.fail(commerceError("receiptMismatch"));
    }
    return { inputs: plan.entities, results: canonical, positions: plan.positions };
  });
}

/** Nested native creates may omit their DTOs from the module return. The
 * complete decoded write cohort supplies those identities, while input order
 * still determines the first occurrence and every justified alias. */
export function correlateScalarCreateWrites<Row extends JsonObject & { readonly id: string }>(
  inputs: readonly JsonObject[], rows: readonly Row[],
) {
  return Result.gen(function* () {
    const positional: Row[] = [], explicit = new Map<string, Row>();
    let ordinal = 0;
    for (const input of inputs) {
      const prior = typeof input.id === "string" ? explicit.get(input.id) : undefined;
      if (prior !== undefined) positional.push(prior);
      else {
        const row = rows[ordinal++];
        if (row === undefined) return yield* Result.fail(commerceError("receiptMismatch"));
        positional.push(row);
        if (typeof input.id === "string") explicit.set(input.id, row);
      }
    }
    if (ordinal !== rows.length) return yield* Result.fail(commerceError("receiptMismatch"));
    return yield* correlateScalarCreateReceipt(inputs, positional);
  });
}
