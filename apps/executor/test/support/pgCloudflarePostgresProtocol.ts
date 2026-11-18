import { Schema } from "effect";

export const PostgresTlsRow = Schema.Struct({
  value: Schema.Literal(1),
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  ssl: Schema.Literal(true),
  tlsVersion: Schema.NonEmptyString,
  cipher: Schema.NonEmptyString,
  superuser: Schema.Literal(false),
  bypass: Schema.Literal(false),
  applicationName: Schema.NonEmptyString,
});

export const PostgresTlsObservation = Schema.Struct({
  ok: Schema.Boolean,
  cause: Schema.NullOr(Schema.String),
  row: Schema.NullOr(PostgresTlsRow),
  actualDriver: Schema.Boolean,
  sslResponses: Schema.Int,
  sslConnectEvents: Schema.Int,
  queriesStarted: Schema.Int,
  endCalls: Schema.Int,
  nativeEndFulfilled: Schema.Boolean,
  streamCloses: Schema.Int,
  clientEnds: Schema.Int,
  clientErrors: Schema.Array(Schema.String),
  errorsAfterEnd: Schema.Int,
  errorListenersAfterEnd: Schema.Int,
});
