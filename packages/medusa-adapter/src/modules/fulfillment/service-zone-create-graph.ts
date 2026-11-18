import { Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CreationProfile, GraphCatalog } from "../../write/graph-model";
import { commerceDecoder } from "../../value/decoder";
import { ServiceZoneCreate, ServiceZoneGeoZoneCreate, type compileServiceZoneCreationContracts } from "./service-zone-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileServiceZoneCreationContracts>>;

/** Generated identities and new child graphs use the shared insert owner. */
export function prepareServiceZoneCreationGraph(contracts: Contracts) {
  const zone = { table: contracts.zone, model: "ServiceZone", keyColumn: "id", prefix: contracts.zone.columns.find(column => column.name === "id")?.options?.prefix },
    geo = { table: contracts.geo, model: "GeoZone", keyColumn: "id", prefix: contracts.geo.columns.find(column => column.name === "id")?.options?.prefix };
  const decodeZone = commerceDecoder(ServiceZoneCreate, "invalidInput"), decodeGeo = commerceDecoder(ServiceZoneGeoZoneCreate, "invalidInput");
  const catalog: GraphCatalog = { entities: [zone, geo], tables: [zone.table, geo.table], writablePivots: [],
    queryRelations: new Map([[zone.table.name, new Map([[contracts.relation.name, contracts.relation]])]]),
    decodeRow: (entity, input) => {
      if (entity === zone) return decodeZone(input).pipe(Result.map(supplied => ({ supplied, key: undefined })));
      if (entity === geo) return decodeGeo(input).pipe(Result.map(supplied => ({ supplied, key: undefined })));
      return Result.fail(commerceError("unsupportedProfile"));
    },
    decodeReference: () => Result.fail(commerceError("unsupportedProfile")),
    decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
  };
  const profile: CreationProfile = { catalog,
    root: { entity: zone, omitRelations: ["geo_zones"], steps: [{ kind: "children", name: "geo_zones", foreignKey: "service_zone_id",
      node: { entity: geo, omitRelations: [], steps: [] } }] },
    rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }),
  };
  return { catalog, profile };
}
