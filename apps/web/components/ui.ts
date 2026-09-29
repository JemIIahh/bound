// Shared control styles (the founder's Stow patterns, translated): one place to restyle the app.
export const card = 'rounded-2xl border border-black/12 bg-white/60 p-7'
export const fieldClass =
  'w-full rounded-xl border border-black/15 bg-white/60 px-4 py-3 font-mono text-sm text-ink outline-none placeholder:text-black/30 focus:border-black/35 aria-[invalid=true]:border-red-700/60'
export const primaryBtn =
  'inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 font-medium text-paper transition hover:bg-ink/85 disabled:opacity-40'
export const ghostBtn =
  'inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/15 px-5 py-3 text-sm text-ink transition hover:bg-black/5 disabled:opacity-40'
export const smallBtn =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/15 px-3 py-1.5 text-xs text-ink transition hover:bg-black/5 disabled:opacity-40'
export const sectionLabel = 'font-mono text-[11px] uppercase tracking-[0.18em] text-graphite'
export const fieldLabel = 'mb-1.5 block text-sm text-ink'
export const errorText = 'break-words text-sm text-red-700'
export const hint = 'text-xs leading-relaxed text-graphite'

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
