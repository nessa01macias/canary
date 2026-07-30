// Single entry point for calls to our own /api/* backend. Injects the
// publishable ("anon") API key so requests pass the backend auth gate
// (backend/app/api/auth.py). The key is build-time public by design — same model
// as a Supabase publishable key — and is Origin-locked by the backend's CORS, so
// exposing it in the bundle is safe. Partner/secret keys are never used here;
// those are server-to-server.
//
// Set VITE_CANARY_ANON_KEY in the frontend build env. If it is unset the header
// is simply omitted (useful for a fully public local backend); against a gated
// backend, an unset key means every call 401s — which is the intended, loud
// failure, not a silent one.
const ANON_KEY = (import.meta.env.VITE_CANARY_ANON_KEY as string | undefined) ?? ''

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (ANON_KEY) headers.set('X-API-Key', ANON_KEY)
  return fetch(path, { ...init, headers })
}
