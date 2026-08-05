import { databasePatch } from "flarex:platform";

export async function patch(_, { id, patch }) {
  await databasePatch(id, patch);
  return null;
}

export function inspectionOnly() {
  return null;
}
