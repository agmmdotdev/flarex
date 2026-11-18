import { snapshotApplicationValidatorJson } from "@flarex/application-schema-definition/validator-json";
import { assertValidatorJson } from "./validatorJson";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

const REFLECT_APPLY = Reflect.apply;
const VALIDATOR_JSON = new WeakMap<object, ValidatorJsonV1>();
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_HAS = WeakMap.prototype.has;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;

export function captureOwnedValidator<Validator extends object>(
  validator: Validator,
  json: ValidatorJsonV1,
): Validator {
  REFLECT_APPLY(WEAK_MAP_SET, VALIDATOR_JSON, [validator, json]);
  return validator;
}

export function isOwnedValidator(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    REFLECT_APPLY(WEAK_MAP_HAS, VALIDATOR_JSON, [value]);
}

/** Owned authoring remains semantic until an actual export asks for JSON. */
function ownedValidatorJson(value: object): ValidatorJsonV1 | undefined {
  return REFLECT_APPLY(WEAK_MAP_GET, VALIDATOR_JSON, [value]);
}

/** Foreign authoring metadata is data, never an executable property accessor. */
export function validatorOwnDataProperty(value: object, key: string): unknown {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`Foreign validator ${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** Internal composition retains unchecked owned authoring until export. */
export function validatorJsonForComposition(
  validator: object,
  path = "$validator.json",
): ValidatorJsonV1 {
  const ownedJson = ownedValidatorJson(validator);
  if (ownedJson !== undefined) return ownedJson;
  const decoded = assertValidatorJson(validatorOwnDataProperty(validator, "json"), path);
  if (decoded === null) throw new Error(`${path}: Validator is required.`);
  return snapshotApplicationValidatorJson(decoded);
}
