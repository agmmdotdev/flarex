const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * Generate a composed id based on the input parameters and return either the is if it exists or the generated one.
 * @param idProperty
 * @param prefix
 */
export function generateEntityId(idProperty?: string, prefix?: string): string {
  if (idProperty) {
    return idProperty
  }

  const id = createUlid()
  prefix = prefix ? `${prefix}_` : ""
  return `${prefix}${id}`
}

function createUlid(): string {
  return `${encodeTime(Date.now(), 10)}${encodeRandom(16)}`
}

function encodeTime(time: number, length: number): string {
  let encoded = ""

  for (let index = 0; index < length; index += 1) {
    encoded = ENCODING[time % 32] + encoded
    time = Math.floor(time / 32)
  }

  return encoded
}

function encodeRandom(length: number): string {
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)

  return Array.from(randomBytes, (byte) => ENCODING[byte % 32]).join("")
}
