import { Effect, Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphCatalog, ReplacementProfile } from "../../write/graph-model";
import { commerceDecoder } from "../../value/decoder";
import { projectNativeRow } from "../../repository/result";
import { ServiceZoneUpdateNormalized, ServiceZoneUpdateNormalizedGeo, type compileServiceZoneUpdateContracts } from "./service-zone-update-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileServiceZoneUpdateContracts>>;

/** Native service membership and normalization precede this storage translation. */
export function prepareServiceZoneUpdateGraph(contracts: Contracts) {
  const zone = { table: contracts.zone, model: "ServiceZone", keyColumn: "id", prefix: contracts.zone.columns.find(column => column.name === "id")?.options?.prefix },
    geo = { table: contracts.geo, model: "GeoZone", keyColumn: "id", prefix: contracts.geo.columns.find(column => column.name === "id")?.options?.prefix };
  const decodeZone = commerceDecoder(ServiceZoneUpdateNormalized, "invalidInput"), decodeGeo = commerceDecoder(ServiceZoneUpdateNormalizedGeo, "invalidInput");
  const catalog: GraphCatalog = { entities: [zone, geo], tables: [zone.table, geo.table], writablePivots: [],
    queryRelations: new Map([[zone.table.name, new Map([[contracts.relation.name, contracts.relation]])]]),
    decodeRow: (entity, input) => {
      if (entity === zone) return decodeZone(input).pipe(Result.map(supplied => ({ supplied, key: supplied.id })));
      if (entity === geo) return decodeGeo(input).pipe(Result.map(supplied => ({ supplied, key: supplied.id })));
      return Result.fail(commerceError("unsupportedProfile"));
    },
    decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
  };
  const profile: ReplacementProfile = { catalog, operation: "update",
    ordering: new Map([[geo.table.name, { kind: "storageInsertion", direction: "asc" }]]),
    allowedRelations: entity => entity === zone ? ["geo_zones"] : [], ownedToOne: () => [], mutableForeignKeys: () => false,
    admitSelection: (table, rows) => Result.gen(function* () {
      const maximum = table === zone.table ? 4 : table === geo.table ? 16 : undefined;
      if (maximum === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* (table === zone.table ? contracts.decodeZoneRow : contracts.decodeGeoRow)(projectNativeRow(row));
    }),
    prepareProjection: () => Effect.void,
    toManyMode: (entity, name, child) => entity === zone && name === "geo_zones" && child === geo
      ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
    validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: (_entity, relations) => relations,
    project: rows => Result.succeed(new Map([...rows].map(([table, rows]) => [table, rows.filter(row => row.deleted_at === null)]))),
  };
  return { zone, geo, catalog, profile };
}
