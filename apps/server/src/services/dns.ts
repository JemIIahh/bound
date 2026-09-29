/** TXT records for `name` via Cloudflare DNS-over-HTTPS. Returns [] when the lookup yields nothing. */
export async function resolveTxt(name: string): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return []
  const body: any = await res.json()
  // Long TXT values arrive as several quoted chunks: "abc" "def" → abcdef
  return (body.Answer ?? []).map((a: any) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''))
}
