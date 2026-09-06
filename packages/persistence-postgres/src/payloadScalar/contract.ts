import type { PayloadProvenance } from "@flarex/analysis/internal/application-write-policy";

/** Closed compatibility profile; these fields also feed Application analysis. */
export const payloadScalarFields = Object.freeze(([
  { name: "createdAt", kind: "date" },
  { name: "enabled", kind: "boolean" },
  { name: "publishedAt", kind: "date" },
  { name: "score", kind: "number" },
  { name: "title", kind: "text" },
  { name: "updatedAt", kind: "date" },
] as const).map(field => Object.freeze(field)));

export const payloadScalarProvenance: PayloadProvenance = Object.freeze({
  format: "flarex.payload-provenance", version: 1, package: "payload", release: "3.88.0",
  npmIntegrity: "sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg==",
  gitTagObject: "c54dea8f4010d9cb194780f2ee1e4b3ec697f9be", gitCommit: "fea6f8a47a50ff1330d8a5071b43e7dcffb97b22",
});
