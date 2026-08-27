const REFLECT_APPLY = Reflect.apply;
const VALIDATOR_INSTANCES = new WeakSet<object>();
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_HAS = WeakSet.prototype.has;

export function captureOwnedValidator<Validator extends object>(
  validator: Validator,
): Validator {
  REFLECT_APPLY(WEAK_SET_ADD, VALIDATOR_INSTANCES, [validator]);
  return validator;
}

export function isOwnedValidator(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    REFLECT_APPLY(WEAK_SET_HAS, VALIDATOR_INSTANCES, [value]);
}
