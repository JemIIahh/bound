/** Looks up an LEI in the GLEIF public API. null when the LEI is malformed or unknown. */
export async function lookupLei(lei: string): Promise<{ legalName: string; status: string } | null> {
  if (!/^[A-Z0-9]{20}$/.test(lei)) return null
  const res = await fetch(`https://api.gleif.org/api/v1/lei-records/${lei}`, {
    headers: { accept: 'application/vnd.api+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  const body: any = await res.json()
  const a = body?.data?.attributes
  if (!a) return null
  return { legalName: a.entity?.legalName?.name ?? '', status: a.registration?.status ?? '' }
}
