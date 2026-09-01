import "reflect-metadata"

const assignedValues: string[] = []

function assignmentField(target: object, propertyKey: string | symbol): void {
  const values = new WeakMap<object, string>()

  Object.defineProperty(target, propertyKey, {
    configurable: true,
    enumerable: true,
    get(this: object): string | undefined {
      return values.get(this)
    },
    set(this: object, value: string): void {
      assignedValues.push(value)
      values.set(this, value)
    },
  })
}

function methodMetadata(
  _target: object,
  _propertyKey: string | symbol,
  _descriptor: PropertyDescriptor
): void {}

class MetadataInput {}

class DecoratedContract {
  @assignmentField
  value: string = "assignment-semantics"

  @methodMetadata
  execute(input: MetadataInput): number {
    return input instanceof MetadataInput ? 1 : 0
  }
}

describe("SWC decorator compatibility", () => {
  it("preserves assignment class fields and emitted decorator metadata", () => {
    const instance = new DecoratedContract()

    expect(instance.value).toBe("assignment-semantics")
    expect(assignedValues).toEqual(["assignment-semantics"])
    expect(Object.prototype.hasOwnProperty.call(instance, "value")).toBe(false)
    expect(
      Reflect.getMetadata("design:type", DecoratedContract.prototype, "value")
    ).toBe(String)
    expect(
      Reflect.getMetadata(
        "design:paramtypes",
        DecoratedContract.prototype,
        "execute"
      )
    ).toEqual([MetadataInput])
    expect(
      Reflect.getMetadata(
        "design:returntype",
        DecoratedContract.prototype,
        "execute"
      )
    ).toBe(Number)
  })
})
