import type { ChangePoint } from './samplePoints'
import { apiFetch } from './api'

// The frontend does NO direct data-source work. It asks our own backend
// (/api/sf/permits) for already-enriched permit change-points; the backend fetches
// DataSF and does all the derivation (change-story, stage, units, cost) server-side.
// Same-origin /api/* → FastAPI (Vite proxy in dev, Caddy in prod).

export async function fetchSfPermits(): Promise<ChangePoint[]> {
  const res = await apiFetch('/api/sf/permits')
  if (!res.ok) throw new Error(`/api/sf/permits failed: ${res.status}`)
  return res.json()
}
