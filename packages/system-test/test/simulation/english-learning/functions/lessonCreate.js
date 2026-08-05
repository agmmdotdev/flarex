import { databaseInsert } from "flarex:platform";

export function create(_, args) {
  return databaseInsert("lessons", args);
}
