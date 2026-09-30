// Shared control styles (Direction C): one place to restyle the app. Colours are the semantic tokens in
// globals.css, so every class here also reads correctly inside the inverted `.inv` card.

/** Page width: 1360 max, 16 px gutter on phones, 32 px from sm. */
export const wrap = 'mx-auto w-full max-w-[1360px] px-4 sm:px-8'

/** Large rounded surface. */
export const card = 'rounded-card border border-line bg-card p-6 shadow-card sm:p-10'
/** The one light card that highlights the item needing action. */
export const invCard = 'inv rounded-card border border-cream bg-cream p-6 shadow-inv sm:p-10'

export const pageTitle = 'font-display text-[40px] font-extrabold leading-[0.98] tracking-[-0.045em] text-fg [font-stretch:96%] sm:text-[56px]'
export const pageLede = 'text-base leading-relaxed text-fg2 sm:text-[17px]'
export const cardTitle = 'text-2xl font-semibold leading-[1.15] tracking-[-0.025em] text-fg sm:text-[26px]'
export const sectionTitle = 'text-2xl font-bold tracking-[-0.03em] text-fg sm:text-[28px]'

export const fieldClass =
  'w-full rounded-btn border border-line bg-field px-4 py-3 font-mono text-sm text-fg outline-none transition placeholder:text-fg3 focus:border-fg3 aria-[invalid=true]:border-acc/70'
export const primaryBtn =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-btn px-6 text-[15px] font-bold text-btn-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-raised disabled:text-fg3 disabled:hover:brightness-100'
export const ghostBtn =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-btn border border-edge px-6 text-[15px] font-bold text-fg transition hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40'
export const smallBtn =
  'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line px-4 text-sm text-fg2 transition hover:border-edge hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'
/** Round solid arrow button (card footers). */
export const roundBtn =
  'grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fg text-card transition hover:scale-105 disabled:opacity-40 aria-expanded:rotate-90'

export const sectionLabel = 'text-sm font-medium text-fg2'
export const fieldLabel = 'mb-2 block text-sm font-medium text-fg'
export const errorText = 'break-words text-sm text-acc2'
export const hint = 'text-[13px] leading-relaxed text-fg3'
export const monoMeta = 'font-mono text-[12.5px] text-fg3'
export const link = 'underline decoration-fg3/50 underline-offset-4 transition hover:text-fg hover:decoration-fg'

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** Only a real 32-byte hash becomes an explorer link. */
export const isTxHash = (v: unknown): v is `0x${string}` => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
