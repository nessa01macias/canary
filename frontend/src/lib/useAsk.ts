import { useCallback, useRef, useState } from 'react'
import type { AskContext } from './scope'
import { apiFetch } from './api'

// The ask flow — question in, block-composed answer out. The model arranges
// components; the server hydrated every number from DuckDB. This hook owns the
// request, a short hidden history (for follow-ups), and the mission. Questions
// carry an optional CONTEXT (the PlaceCard scope) so "here" means the place
// the user is looking at.

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

type HistTurn = { role: 'user' | 'assistant'; content: string }

// A visible exchange: the question the user asked + the composed answer.
// The card renders these STACKED — replying must never delete what came before
// (a conversation you can't scroll back through doesn't feel like one).
export type AskTurn = { question: string; result: AskResult }

const MAX_VISIBLE_TURNS = 4

export function useAsk() {
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<AskTurn[]>([])
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const historyRef = useRef<HistTurn[]>([])

  const clear = useCallback(() => {
    setTurns([])
    setLastQuestion(null)
  }, [])

  // Navigating to a different place is a different conversation.
  const resetThread = useCallback(() => {
    historyRef.current = []
  }, [])

  const ask = useCallback(async (question: string, context?: AskContext) => {
    const q = question.trim()
    if (!q) return
    setBusy(true)
    setLastQuestion(q)
    const append = (result: AskResult) =>
      setTurns((prev) => [...prev, { question: q, result }].slice(-MAX_VISIBLE_TURNS))
    try {
      const resp = await apiFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history: historyRef.current.slice(-6),
          mission: readMission(),
          context: context ?? null,
        }),
      })
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => null))?.detail ?? `Server ${resp.status}`
        append({ blocks: [{ type: 'answer', md: String(detail) }], followups: [] })
        return
      }
      const data: AskResult = await resp.json()
      append(data)
      // Feed the hidden thread so follow-ups have context.
      const answerMd =
        (data.blocks.find((b) => b.type === 'answer') as { md?: string } | undefined)?.md ?? ''
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: q },
        { role: 'assistant', content: answerMd },
      ].slice(-6) as HistTurn[]
    } catch (e) {
      append({
        blocks: [{ type: 'answer', md: `Couldn't reach the server: ${e instanceof Error ? e.message : e}` }],
        followups: [],
      })
    } finally {
      setBusy(false)
    }
  }, [])

  // The newest answer — what App's auto-execute effect watches for action blocks.
  const result = turns.length ? turns[turns.length - 1].result : null

  return { busy, turns, result, lastQuestion, ask, clear, resetThread }
}
