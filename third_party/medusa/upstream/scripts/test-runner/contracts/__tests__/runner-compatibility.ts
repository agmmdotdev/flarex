import { http } from "msw"
import { until } from "until-async"

import { exactAliasValue } from "@contract-services"
import { nestedAliasValue } from "@contract-services/nested"
import { nonMatchingAliasValue } from "@contract-services-other"

jest.setTimeout(10_000)

describe("shared Node runner compatibility", () => {
  const lifecycle: string[] = []

  beforeEach(() => {
    lifecycle.push("before")
  })

  afterEach(() => {
    lifecycle.push("after")
  })

  it("preserves aliases, dependency handling, mocks, and hook order", async () => {
    expect(exactAliasValue).toBe("exact-service-alias")
    expect(nestedAliasValue).toBe("nested-service-alias")
    expect(nonMatchingAliasValue).toBe("non-matching-service-alias")
    expect(typeof http.get).toBe("function")

    const [error, value] = await until(async () => "until-result")
    expect(error).toBeNull()
    expect(value).toBe("until-result")

    const mock = jest
      .fn((input: string) => `base:${input}`)
      .mockImplementationOnce((input: string) => `once:${input}`)

    expect(mock("first")).toBe("once:first")
    expect(mock("second")).toBe("base:second")
    expect(mock).toHaveBeenNthCalledWith(1, "first")
    expect(mock).toHaveBeenNthCalledWith(2, "second")

    expect(jest.clearAllMocks()).toBe(jest)
    expect(mock).not.toHaveBeenCalled()
    expect(mock("third")).toBe("base:third")
    expect(lifecycle).toEqual(["before"])
  })

  it("restores spies without resetting standalone mock implementations", () => {
    expect(lifecycle).toEqual(["before", "after", "before"])

    const target = {
      read: (value: string) => `original:${value}`,
    }
    const standalone = jest.fn(() => "standalone")
    const spy = jest
      .spyOn(target, "read")
      .mockImplementationOnce((value: string) => `mock:${value}`)

    expect(target.read("first")).toBe("mock:first")
    expect(target.read("second")).toBe("original:second")
    expect(spy).toHaveBeenCalledTimes(2)
    expect(standalone()).toBe("standalone")

    expect(jest.restoreAllMocks()).toBe(jest)
    expect(target.read("third")).toBe("original:third")
    expect(standalone()).toBe("standalone")

    expect({
      exactAliasValue,
      nestedAliasValue,
      nonMatchingAliasValue,
    }).toMatchInlineSnapshot(`
      {
        "exactAliasValue": "exact-service-alias",
        "nestedAliasValue": "nested-service-alias",
        "nonMatchingAliasValue": "non-matching-service-alias",
      }
    `)
  })

  it.skip("preserves skipped tests in normalized results", () => undefined)
  it.todo("preserves todo tests in normalized results")
})
