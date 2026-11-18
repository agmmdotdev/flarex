import type { PayloadConfiguration } from "./model";
import { Effect, Schema } from "effect";
import { LogicalDocumentUniqueConstraintDeclarationSchema } from "flarex-protocol/app-unique-constraint-definition";
import { digestApplicationWritePolicyFrame } from "./verification";

const decodeDeclaration = Schema.decodeUnknownEffect(LogicalDocumentUniqueConstraintDeclarationSchema);

/** Constraint intent from checked metadata; persistence owns identity and enforcement. */
export function payloadUniqueSelections(table: PayloadConfiguration["tables"][number]): readonly (readonly string[])[] {
  const selections = [
    ...table.fields.flatMap(field => field.kind !== "relationship" && field.unique === true ? [[field.name]] : []),
    ...(table.indexes?.filter(index => index.unique === true).map(index => index.fields) ?? []),
  ];
  const seen = new Set<string>();
  return Object.freeze(selections.filter(fields => {
    const key = JSON.stringify(fields);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(fields => Object.freeze([...fields])));
}

/** One checked producer translation shared by current Application publication
 * and multi-source composition. Keep exact names and null semantics identical. */
export const payloadUniqueDeclarations = Effect.fn("PayloadUniqueDeclarations.compile")(function* (
  table: PayloadConfiguration["tables"][number],
) {
  const declarations = [];
  for (const fields of payloadUniqueSelections(table)) {
    const digest = yield* digestApplicationWritePolicyFrame(fields);
    declarations.push(yield* decodeDeclaration({ tableLogicalName: table.logicalTableName,
      descriptor: `u_${digest.slice(0, 60)}`, fields, sparse: false,
      nullsDistinct: fields.some(name => table.fields.some(field => field.name === name && field.kind !== "relationship" && field.nullable)),
    }).pipe(Effect.orDie));
  }
  return Object.freeze(declarations);
});
