import { databasePatch } from "flarex:platform";

export async function patch(_, { id, patch }) {
  await databasePatch(id, patch);
  return null;
}

export async function patchThenReturnInvalid(_, { id }) {
  await databasePatch(id, { title: "This value must roll back." });
  return "not-null";
}

export async function patchThenThrow(_, { id }) {
  await databasePatch(id, { title: "This throw must roll back." });
  throw "Injected cooking mutation failure.";
}

export function inspectionOnly() {
  return null;
}
