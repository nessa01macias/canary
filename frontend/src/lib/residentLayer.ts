// The resident layer — the READ side of the give-to-get moat. The backend
// serves only k-anonymised (n ≥ 3) aggregates (GET /api/resident-layer); raw
// reviews are structurally unreadable. This module fetches both granularities
// and folds them into one per-neighborhood lookup for the hover popup.

import { apiFetch } from './api'

export type ResidentAgg = {
  n: number
  safety: number | null
  noise: number | null
  trajectory: number | null
}

type ApiResidentLayer = {
  areas: {
    place_label: string
    n_reviews: number
    avg_safety: number | null
    avg_noise: number | null
    avg_trajectory: number | null
  }[]
  hexes: {
    h3_9: string
    neighborhood: string | null
    n_reviews: number
    avg_safety: number | null
    avg_noise: number | null
    avg_trajectory: number | null
  }[]
  k_floor: number
}

export async function fetchResidentLayer(): Promise<Map<string, ResidentAgg>> {
  const res = await apiFetch('/api/resident-layer')
  if (!res.ok) throw new Error(`/api/resident-layer failed: ${res.status}`)
  const data: ApiResidentLayer = await res.json()

  const byArea = new Map<string, ResidentAgg>()

  // Area-level rows are authoritative (keyed by the picked area name).
  for (const a of data.areas) {
    byArea.set(a.place_label, {
      n: a.n_reviews,
      safety: a.avg_safety,
      noise: a.avg_noise,
      trajectory: a.avg_trajectory,
    })
  }

  // Hex-level rows fill neighborhoods the area view hasn't reached yet
  // (n-weighted average across a neighborhood's qualifying hexes).
  const hexAcc = new Map<string, { n: number; s: number; q: number; t: number }>()
  for (const h of data.hexes) {
    if (!h.neighborhood || byArea.has(h.neighborhood)) continue
    const acc = hexAcc.get(h.neighborhood) ?? { n: 0, s: 0, q: 0, t: 0 }
    acc.n += h.n_reviews
    acc.s += (h.avg_safety ?? 0) * h.n_reviews
    acc.q += (h.avg_noise ?? 0) * h.n_reviews
    acc.t += (h.avg_trajectory ?? 0) * h.n_reviews
    hexAcc.set(h.neighborhood, acc)
  }
  for (const [nhood, acc] of hexAcc) {
    byArea.set(nhood, {
      n: acc.n,
      safety: acc.n ? acc.s / acc.n : null,
      noise: acc.n ? acc.q / acc.n : null,
      trajectory: acc.n ? acc.t / acc.n : null,
    })
  }

  return byArea
}
