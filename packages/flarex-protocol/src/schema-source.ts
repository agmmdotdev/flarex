import type { Brand } from "effect";

/** Producer lineage is a source coordinate, never a catalog ID or authority. */
export type SchemaLineageId = Brand.Branded<string, "FlarexDB/SchemaLineageId">;
