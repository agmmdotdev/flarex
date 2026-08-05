import { databaseGet } from "flarex:platform";

export function get(_, { id }) {
  return databaseGet(id);
}
