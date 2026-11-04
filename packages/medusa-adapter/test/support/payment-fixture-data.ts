import type { Logger } from "@medusajs/framework/types";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const stamp = "2026-10-23T00:00:00.000Z";
export const paymentCollectionId = "pay_col_sessions";

export function paymentCollectionSeed(): { table: string; row: JsonObject } {
  return { table: "payment_collection", row: { id: paymentCollectionId, currency_code: "usd", amount: "12.5", raw_amount: { value: "12.5", precision: 20 },
    authorized_amount: null, raw_authorized_amount: null, captured_amount: null, raw_captured_amount: null,
    refunded_amount: null, raw_refunded_amount: null, completed_at: null, status: "not_paid", metadata: null,
    created_at: stamp, updated_at: stamp, deleted_at: null } };
}

export function paymentSessionSeed(id: string, data: JsonObject = {}): { table: string; row: JsonObject } {
  return { table: "payment_session", row: { id, payment_collection_id: paymentCollectionId, currency_code: "usd", amount: "12.5",
    raw_amount: { value: "12.5", precision: 20 }, provider_id: "pp_system_default", data, context: null,
    status: "pending", authorized_at: null, metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null } };
}

export function makePaymentFixtureLogger() {
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: message => { errors.push(String(message)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {},
    http() {}, info() {}, warn() {}, log() {} };
  return { logger, errors };
}
