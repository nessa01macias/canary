import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

// Ask Canary — intent-language in ("I want to open a café"), grounded facts +
// MAP ACTIONS out. The panel is the consumer face of the B2B grounding feed:
// same data, rate-limited, with the model driving the map (fly-to + chips).

type AskResponse = {
  answer_md: string
  neighborhoods: string[]
  chips: string[]
  followups: string[]
  grounded_on: { areas?: number; as_of?: string }
}

type Msg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; actions?: AskResponse }

const STARTERS = [
  'Which neighborhoods are getting quieter?',
  'I want to open a café — where is retail momentum?',
  'Where is the most housing being built?',
  'Where are evictions rising fastest?',
]

type Props = {
  onShowNeighborhood: (nhood: string) => void
  onApplyChips: (chips: string[]) => void
}

export function AskCanary({ onShowNeighborhood, onApplyChips }: Props) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  async function send(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: q }])
    setBusy(true)
    try {
      const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }))
      const resp = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      })
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => null))?.detail ?? `Server ${resp.status}`
        setMsgs((m) => [...m, { role: 'assistant', content: String(detail) }])
        return
      }
      const data: AskResponse = await resp.json()
      setMsgs((m) => [...m, { role: 'assistant', content: data.answer_md, actions: data }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Couldn't reach the server: ${e instanceof Error ? e.message : e}` }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="ask-launcher" onClick={() => setOpen(true)}>
        🐤 Ask Canary
      </button>
    )
  }

  return (
    <aside className="ask-panel">
      <header className="ask-head">
        <div>
          <div className="ask-title">🐤 Ask Canary</div>
          <div className="ask-sub">Answers grounded in SF public records — cited, never invented</div>
        </div>
        <button className="drawer-close" onClick={() => setOpen(false)}>×</button>
      </header>

      <div className="ask-scroll" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="ask-starters">
            <p className="ask-starters-label">Try an intent:</p>
            {STARTERS.map((s) => (
              <button key={s} className="ask-starter" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ask-msg--${m.role}`}>
            {m.role === 'assistant' ? (
              <>
                <div className="ask-md"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                {m.actions && (m.actions.neighborhoods.length > 0 || m.actions.chips.length > 0) && (
                  <div className="ask-actions">
                    {m.actions.neighborhoods.map((n) => (
                      <button key={n} className="ask-action" onClick={() => onShowNeighborhood(n)}>
                        ⌖ {n}
                      </button>
                    ))}
                    {m.actions.chips.length > 0 && (
                      <button
                        className="ask-action ask-action--chips"
                        onClick={() => onApplyChips(m.actions!.chips)}
                      >
                        ✦ Rank the map: {m.actions.chips.join(' + ')}
                      </button>
                    )}
                  </div>
                )}
                {m.actions && m.actions.followups.length > 0 && (
                  <div className="ask-followups">
                    {m.actions.followups.map((f) => (
                      <button key={f} className="ask-followup" onClick={() => send(f)}>{f}</button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              m.content
            )}
          </div>
        ))}

        {busy && <div className="ask-msg ask-msg--assistant ask-busy">Reading the public record…</div>}
      </div>

      <form
        className="ask-inputrow"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          className="ask-input"
          placeholder="Moving? Buying? Opening a shop? Ask…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="ask-send" type="submit" disabled={busy || !input.trim()}>→</button>
      </form>
    </aside>
  )
}
