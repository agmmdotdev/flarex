import type { PayloadConfiguration } from "./model";

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
