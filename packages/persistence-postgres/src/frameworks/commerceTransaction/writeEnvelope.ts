import { sql, type SQL } from "drizzle-orm";
import { Result, Schema } from "effect";
import { commerceError, commerceLimits } from "./model";
import { defaultCommerceResources, type CommerceResources } from "./resources";

export interface CommerceCatalogSize { readonly total: number; readonly maximum: number; readonly bytes: number }

const boundedInteger = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }));

export function makeCommerceWriteEnvelopePolicy(resources: CommerceResources) {

  const Catalog = Schema.Struct({
    total: boundedInteger(resources.catalogRows + 1),
    maximum: boundedInteger(commerceLimits.rowBytes + 1),
    bytes: boundedInteger(resources.commandBytes + 1),
  });
  const Envelope = Schema.Struct({
    ...Catalog.fields,
    transportMaximum: boundedInteger(commerceLimits.rowBytes + 1),
    transportBytes: boundedInteger(resources.commandBytes + 1),
    rows: Schema.NullOr(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(resources.writeBatchRows))),
  });
  const decodeEnvelope = Schema.decodeUnknownResult(Envelope, { onExcessProperty: "error" });

  const checkCommerceCatalogSize = (size: CommerceCatalogSize, remainingBytes: number) =>
    size.total > resources.catalogRows || size.maximum > commerceLimits.rowBytes || size.bytes > remainingBytes
      ? Result.fail(commerceError("limitExceeded")) : Result.succeed(undefined);

  /** Package-private SQL composition. The caller owns admitted identifiers, SQL
   * execution, cancellation, row decoding and transaction settlement. */
  function commerceWriteEnvelope(input: {
    mutation: SQL; retainedCatalog: SQL; writtenCatalogPayload: SQL; writtenTransportPayload: SQL; remainingBytes: number;
  }): SQL {
    return sql`with changed as (${input.mutation}),
      catalog as materialized (
        select payload from (${input.retainedCatalog} union all
          select ${input.writtenCatalogPayload} as payload from changed) combined limit ${resources.catalogRows + 1}
      ),
      catalog_size as (
        select count(*)::integer as total,
          least(coalesce(max(octet_length(payload::text)), 0), ${commerceLimits.rowBytes + 1})::integer as maximum,
          least(coalesce(sum(octet_length(payload::text)), 0), ${resources.commandBytes + 1})::integer as bytes from catalog
      ),
      transport as materialized (select ${input.writtenTransportPayload} as payload from changed),
      transport_size as (
        select least(coalesce(max(octet_length(payload::text)), 0), ${commerceLimits.rowBytes + 1})::integer as maximum,
          least(coalesce(sum(octet_length(payload::text)), 0) + 2 * greatest(count(*), 1), ${resources.commandBytes + 1})::integer as bytes from transport
      )
      select c.total, c.maximum, c.bytes, t.maximum as "transportMaximum", t.bytes as "transportBytes",
        case when c.total <= ${resources.catalogRows} and c.maximum <= ${commerceLimits.rowBytes}
          and c.bytes <= ${input.remainingBytes} and t.maximum <= ${commerceLimits.rowBytes} and t.bytes <= ${input.remainingBytes}
          then (select coalesce(jsonb_agg(payload), '[]'::jsonb) from transport) else null::jsonb end as rows
        from catalog_size c cross join transport_size t`;
  }

  const decodeCommerceWriteEnvelope = (input: unknown, remainingBytes: number) => Result.gen(function* () {
    const envelope = yield* decodeEnvelope(input).pipe(Result.mapError(cause => commerceError("storedCorruption", cause)));
    yield* checkCommerceCatalogSize(envelope, remainingBytes);
    if (envelope.transportMaximum > commerceLimits.rowBytes || envelope.transportBytes > remainingBytes)
      return yield* Result.fail(commerceError("limitExceeded"));
    if (envelope.rows === null) return yield* Result.fail(commerceError("storedCorruption"));
    return { ...envelope, rows: envelope.rows };
  });

  return { commerceWriteEnvelope, decodeCommerceWriteEnvelope, checkCommerceCatalogSize };
}

export const { commerceWriteEnvelope, decodeCommerceWriteEnvelope, checkCommerceCatalogSize } = makeCommerceWriteEnvelopePolicy(defaultCommerceResources);
