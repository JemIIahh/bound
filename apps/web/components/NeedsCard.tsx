import { Pill } from './atoms'
import { card, cardTitle } from './ui'

/** "What you'll need" side card for the setup flows. */
export function NeedsCard({ title, items, note }: { title: string; items: { label: string; text: string }[]; note?: string }) {
  return (
    <aside className={`${card} flex flex-col`}>
      <div className="flex items-center justify-between gap-4">
        <Pill>Before you start</Pill>
        <span className="text-[15px] text-fg3">{items.length} things</span>
      </div>
      <h2 className={`mt-6 ${cardTitle}`}>{title}</h2>
      <ol className="mt-6 flex flex-col">
        {items.map((it, i) => (
          <li key={it.label} className={`flex gap-4 py-4 ${i ? 'border-t border-line2' : 'pt-0'}`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised font-mono text-[12px] text-fg2">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-fg">{it.label}</p>
              <p className="mt-0.5 text-[14.5px] leading-relaxed text-fg2">{it.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {note && <p className="mt-auto border-t border-line2 pt-5 text-[14.5px] leading-relaxed text-fg3">{note}</p>}
    </aside>
  )
}
