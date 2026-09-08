import { sql, type SQL } from "drizzle-orm";
import { Result, Schema } from "effect";
import { commerceError, commerceLimits } from "./model";

const boundedInteger = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }));
const Catalog = Schema.Struct({
  total: boundedInteger(commerceLimits.catalogRows + 1),
  maximum: boundedInteger(commerceLimits.rowBytes + 1),
  bytes: boundedInteger(commerceLimits.commandBytes + 1),
});
const Envelope = Schema.Struct({
  ...Catalog.fields,
  transportMaximum: boundedInteger(commerceLimits.rowBytes + 1),
  transportBytes: boundedInteger(commerceLimits.commandBytes + 1),
  rows: Schema.NullOr(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows))),
});
const decodeEnvelope = Schema.decodeUnknownResult(Envelope, { onExcessProperty: "error" });
export type CommerceCatalogSize = typeof Catalog.Type;

export const checkCommerceCatalogSize = (size: CommerceCatalogSize, remainingBytes: number) =>
  size.total > commerceLimits.catalogRows || size.maximum > commerceLimits.rowBytes || size.bytes > remainingBytes
    ? Result.fail(commerceError("limitExceeded")) : Result.succeed(undefined);

/** Package-private SQL composition. The caller owns admitted identifiers, SQL
 * execution, cancellation, row decoding and transaction settlement. */
export function commerceWriteEnvelope(input: {
  mutation: SQL; retainedCatalog: SQL; writtenCatalogPayload: SQL; writtenTransportPayload: SQL; remainingBytes: number;
}): SQL {
  return sql`with changed as (${input.mutation}),
    catalog as materialized (
      select payload from (${input.retainedCatalog} union all
        select ${input.writtenCatalogPayload} as payload from changed) combined limit ${commerceLimits.catalogRows + 1}
    ),
    catalog_size as (
      select count(*)::integer as total,
        least(coalesce(max(octet_length(payload::text)), 0), ${commerceLimits.rowBytes + 1})::integer as maximum,
        least(coalesce(sum(octet_length(payload::text)), 0), ${commerceLimits.commandBytes + 1})::integer as bytes from catalog
    ),
    transport as materialized (select ${input.writtenTransportPayload} as payload from changed),
    transport_size as (
      select least(coalesce(max(octet_length(payload::text)), 0), ${commerceLimits.rowBytes + 1})::integer as maximum,
        least(coalesce(sum(octet_length(payload::text)), 0) + 2 * greatest(count(*), 1), ${commerceLimits.commandBytes + 1})::integer as bytes from transport
    )
    select c.total, c.maximum, c.bytes, t.maximum as "transportMaximum", t.bytes as "transportBytes",
      case when c.total <= ${commerceLimits.catalogRows} and c.maximum <= ${commerceLimits.rowBytes}
        and c.bytes <= ${input.remainingBytes} and t.maximum <= ${commerceLimits.rowBytes} and t.bytes <= ${input.remainingBytes}
        then (select coalesce(jsonb_agg(payload), '[]'::jsonb) from transport) else null::jsonb end as rows
      from catalog_size c cross join transport_size t`;
}

export const decodeCommerceWriteEnvelope = (input: unknown, remainingBytes: number) => Result.gen(function* () {
  const envelope = yield* decodeEnvelope(input).pipe(Result.mapError(cause => commerceError("storedCorruption", cause)));
  yield* checkCommerceCatalogSize(envelope, remainingBytes);
  if (envelope.transportMaximum > commerceLimits.rowBytes || envelope.transportBytes > remainingBytes)
    return yield* Result.fail(commerceError("limitExceeded"));
  if (envelope.rows === null) return yield* Result.fail(commerceError("storedCorruption"));
  return { ...envelope, rows: envelope.rows };
});
