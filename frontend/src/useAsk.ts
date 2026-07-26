import { useCallback, useRef, useState } from 'react'

// The ask flow — omnibox question in, block-composed answer out. The model
// arranges components; the server hydrated every number from DuckDB. This hook
// owns the request, a short hidden history (for follow-ups), and the mission.

export type SeriesPoint = { period: string; value: number }

export type Block =
  | { type: 'answer'; md: string }
  | { type: 'rank_map'; chips: string[] }
  | { type: 'flyto'; neighborhood: string }
  | {
      type: 'compare'
      areas: string[]
      metrics: string[]
      series: Record<string, Record<string, SeriesPoint[]>>
    }
  | {
      type: 'residents'
      area: string
      n_reviews: number
      safety: number | null
      quiet: number | null
      getting_better: number | null
    }

export type AskResult = {
  blocks: Block[]
  followups: string[]
  grounded_on?: { areas?: number; as_of?: string }
  model?: string
}

export type Mission = 'moving' | 'buying' | 'opening_business' | 'exploring'

function readMission(): Mission | null {
  const m = localStorage.getItem('canary_mission')
  return m === 'moving' || m === 'buying' || m === 'opening_business' || m === 'exploring'
    ? m
    : null
}

type Turn = { role: 'user' | 'assistant'; content: string }

export function useAsk() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const historyRef = useRef<Turn[]>([])

  const clear = useCallback(() => {
    setResult(null)
    setLastQuestion(null)
  }, [])

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q) return
    setBusy(true)
    setLastQuestion(q)
    setResult(null)
    try {
      const resp = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history: historyRef.current.slice(-6),
          mission: readMission(),
        }),
      })
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => null))?.detail ?? `Server ${resp.status}`
        setResult({ blocks: [{ type: 'answer', md: String(detail) }], followups: [] })
        return
      }
      const data: AskResult = await resp.json()
      setResult(data)
      // Feed the hidden thread so follow-ups have context.
      const answerMd =
        (data.blocks.find((b) => b.type === 'answer') as { md?: string } | undefined)?.md ?? ''
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: q },
        { role: 'assistant', content: answerMd },
      ].slice(-6) as Turn[]
    } catch (e) {
      setResult({
        blocks: [{ type: 'answer', md: `Couldn't reach the server: ${e instanceof Error ? e.message : e}` }],
        followups: [],
      })
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, result, lastQuestion, ask, clear }
}
