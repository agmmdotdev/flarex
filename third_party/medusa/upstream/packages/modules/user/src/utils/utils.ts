export function getExpiresAt(expiresIn: string | number) {
  const expiresAt =
    typeof expiresIn === "number"
      ? new Date(Date.now() + expiresIn * 1000)
      : new Date(Date.now() + parseTimespanSeconds(expiresIn) * 1000)

  return expiresAt
}

function parseTimespanSeconds(value: string): number {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*)(ms|s|m|h|d)?$/)
  if (!match) {
    throw new Error(`Invalid timespan value: ${value}`)
  }

  const amount = Number(match[1])
  const unit = match[2] ?? "ms"

  switch (unit) {
    case "ms":
      return Math.floor(amount / 1000)
    case "s":
      return amount
    case "m":
      return amount * 60
    case "h":
      return amount * 60 * 60
    case "d":
      return amount * 60 * 60 * 24
  }

  throw new Error(`Invalid timespan unit: ${unit}`)
}
