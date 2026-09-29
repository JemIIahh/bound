const chains = new Map<string, Promise<unknown>>()

/** In-process promise-chain mutex per org: calls for the same org run one at a time, in order. */
export function withOrgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(orgId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next.catch(() => undefined)
  chains.set(orgId, tail)
  // drop the entry once this call is the last one queued, so the map does not grow per org forever
  void tail.then(() => { if (chains.get(orgId) === tail) chains.delete(orgId) })
  return next
}
