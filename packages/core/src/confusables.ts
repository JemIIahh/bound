// Characters that render like Latin letters. Keys are lowercase (input is lowercased first).
const MAP: Record<string, string> = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ɡ': 'g', 'ı': 'i', 'ⅼ': 'l', 'ｌ': 'l',
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w',
}

export function mapConfusables(s: string): { text: string; changed: boolean } {
  let changed = false
  const text = [...s].map((ch) => {
    const m = MAP[ch]
    if (m) { changed = true; return m }
    return ch
  }).join('')
  return { text, changed }
}
