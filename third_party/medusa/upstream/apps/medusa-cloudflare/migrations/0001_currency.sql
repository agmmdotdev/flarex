-- Generated baseline from Medusa currency DML. Do not edit.
CREATE TABLE IF NOT EXISTS "currency" (
  "code" TEXT PRIMARY KEY NOT NULL,
  "symbol" TEXT NOT NULL,
  "symbol_native" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "decimal_digits" INTEGER NOT NULL DEFAULT 0,
  "rounding" REAL NOT NULL DEFAULT 0,
  "raw_rounding" TEXT NOT NULL DEFAULT '{"value":"0","precision":20}',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER
);
