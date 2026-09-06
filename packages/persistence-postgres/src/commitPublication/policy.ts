import { Result } from "effect";
import { publicationError, MAX_MUTATION_RECEIPTS } from "./model";

interface ReceiptCandidateShape {
  readonly array: boolean;
  readonly prototype: unknown;
  readonly descriptors: PropertyDescriptorMap;
}

/** Preserve token identity while refusing caller accessors, iterators and sparse arrays. */
export function captureReceiptCandidates(input: unknown) {
  return Result.gen(function* () {
    const shape = yield* Result.try({
      try: (): ReceiptCandidateShape => ({
        array: Array.isArray(input),
        prototype:
          typeof input === "object" && input !== null
            ? Object.getPrototypeOf(input)
            : undefined,
        descriptors:
          typeof input === "object" && input !== null
            ? Object.getOwnPropertyDescriptors(input)
            : {},
      }),
      catch: () => publicationError("invalidReceiptAuthority"),
    });
    const length: unknown = shape.descriptors.length?.value;
    if (
      !shape.array ||
      shape.prototype !== Array.prototype ||
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > MAX_MUTATION_RECEIPTS ||
      Reflect.ownKeys(shape.descriptors).length !== length + 1
    )
      return yield* Result.fail(publicationError("invalidReceiptAuthority"));
    const owned: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = shape.descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      )
        return yield* Result.fail(publicationError("invalidReceiptAuthority"));
      owned.push(descriptor.value);
    }
    return Object.freeze(owned);
  });
}
