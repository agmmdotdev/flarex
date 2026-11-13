import { Schema } from "effect";

const Path = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,15}$/));
export const GraphQueryContexts = Schema.Record(Path, Schema.JsonObject).check(Schema.makeFilter(value => Object.keys(value).length <= 16));
export type GraphQueryContexts = typeof GraphQueryContexts.Type;
