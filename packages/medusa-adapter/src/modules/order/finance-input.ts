import { Schema } from "effect";
import { OrderChangeStatus } from "@medusajs/framework/utils/portable";
import { ScalarId as Id } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";

const Ids = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const IdFilter = Schema.Union([Id, Ids]);
const Text = Schema.optionalKey(Schema.String);
const AmountText = Schema.String.check(Schema.isLengthBetween(1, 128));
const NativeRawAmount = Schema.Struct({ ...ExactNumericRaw.fields, value: AmountText });
const Amount = Schema.Union([AmountText, Schema.Number.check(Schema.isFinite()), NativeRawAmount]);
export const OrderFinanceTransaction = Schema.Struct({ order_id: Id, amount: Amount, currency_code: Schema.String,
  reference: Text, reference_id: Text });
export const OrderFinanceTransactions = Schema.Array(OrderFinanceTransaction).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4),
  Schema.makeFilter(rows => rows.every(row => row.order_id === rows[0]?.order_id) || "Expected one Order per financial call"));
export const OrderFinanceChange = Schema.Struct({ order_id: Id, change_type: Schema.Literal("credit_line"), created_by: Text });
export const OrderFinanceAction = Schema.Struct({ order_change_id: Id, order_id: Schema.optionalKey(Id),
  version: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  action: Schema.Literal("CREDIT_LINE_ADD"), amount: Amount, reference: Text, reference_id: Text });
export const OrderFinanceActions = Schema.Array(OrderFinanceAction).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4));
export const OrderFinanceConfirm = Schema.Array(Schema.Struct({ id: Id, confirmed_by: Text })).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4));
export const OrderFinanceDelete = Schema.Union([Id, Ids]);
export const OrderFinanceUndo = Schema.Struct({ order_id: Id, previous: Schema.optionalKey(Schema.Struct({
  id: Id, order_id: Id, status: Schema.optionalKey(Schema.Literals(Object.values(OrderChangeStatus))), confirmed_by: Text,
})) });
const Select = Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 128));
export const OrderFinanceRead = Schema.Struct({ filters: Schema.Struct({ id: Schema.optionalKey(IdFilter), order_id: Schema.optionalKey(IdFilter),
  version: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
  status: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(4))])),
  $or: Schema.optionalKey(Schema.Array(Schema.Struct({ order_id: Id, reference: Text, reference_id: Text })).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
}), config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Select),
  relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(32))),
  take: Schema.optionalKey(Schema.Literals([4, 15, 256])), skip: Schema.optionalKey(Schema.Literal(0)),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
})) });
export const decodeOrderFinanceTransactions = commerceDecoder(OrderFinanceTransactions, "invalidInput");
export const decodeOrderFinanceChange = commerceDecoder(OrderFinanceChange, "invalidInput");
export const decodeOrderFinanceActions = commerceDecoder(OrderFinanceActions, "invalidInput");
export const decodeOrderFinanceConfirm = commerceDecoder(OrderFinanceConfirm, "invalidInput");
export const decodeOrderFinanceDelete = commerceDecoder(OrderFinanceDelete, "invalidInput");
export const decodeOrderFinanceUndo = commerceDecoder(OrderFinanceUndo, "invalidInput");
export const decodeOrderFinanceRead = commerceDecoder(OrderFinanceRead, "invalidInput");
