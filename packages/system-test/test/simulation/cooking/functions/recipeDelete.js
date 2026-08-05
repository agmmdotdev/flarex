import { databaseDelete } from "flarex:platform";

export async function remove(_, { id }) {
  await databaseDelete(id);
  return null;
}
