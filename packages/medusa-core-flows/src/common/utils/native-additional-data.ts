import type { AdditionalData as NativeAdditionalData } from "@medusajs/types";

/** Native composers explicitly forward absent additional_data before the
 * existing workflow capture omits undefined properties. */
export type AdditionalData = { [Key in keyof NativeAdditionalData]?: NativeAdditionalData[Key] | undefined };

/** Native composers retain explicit undefined on optional DTO members until
 * callback capture owns omission. Required native members stay required. */
export type NativeOptionalFields<Value> = { [Key in keyof Value]: {} extends Pick<Value, Key> ? Value[Key] | undefined : Value[Key] };
