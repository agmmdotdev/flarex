const getMessageError = (state: PromiseRejectedResult) =>
  state.reason instanceof Error ? state.reason.message : String(state.reason)

const isRejected = (
  state: PromiseSettledResult<unknown>
): state is PromiseRejectedResult => {
  return state.status === "rejected"
}

const isFulfilled = (
  state: PromiseSettledResult<unknown>
): state is PromiseFulfilledResult<unknown> => {
  return state.status === "fulfilled"
}

/**
 * Promise.allSettled with error handling, safe alternative to Promise.all
 * @param promises
 * @param aggregateErrors
 */
export async function promiseAll<T extends readonly unknown[] | []>(
  promises: T,
  { aggregateErrors } = { aggregateErrors: false }
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  if (!promises.length) {
    return [] as { -readonly [P in keyof T]: Awaited<T[P]> }
  }

  const states: PromiseSettledResult<unknown>[] = [
    ...(await Promise.allSettled(promises)),
  ]
  const rejected = states.filter(isRejected)

  if (rejected.length) {
    if (aggregateErrors) {
      throw new Error(rejected.map(getMessageError).join("\n"))
    }

    throw rejected[0].reason // Re throw the error itself
  }

  return states.filter(isFulfilled).map((state) => state.value) as {
    -readonly [P in keyof T]: Awaited<T[P]>
  }
}
