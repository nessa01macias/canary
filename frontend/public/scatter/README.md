# Scattered-source mockups

Drop the six rendered PNGs here for the landing page's "before/after" scatter
(`Landing.tsx` § `SCATTER_ITEMS`). Exact filenames — must match, referenced
directly by path:

- `zoning-map.png`
- `council-agenda.png`
- `email-thread.png`
- `permit-spreadsheet.png`
- `voicemail-call.png`
- `submittal-checklist.png`

Spec for each (dimensions, copy, style tokens) lives in the asset brief.
Until a file exists at one of these paths, that tile falls back to a plain
text card in the same footprint — nothing shifts or breaks when the real
asset lands.

Same six files are reused, greyscaled and faded, as the ghosted backdrop in
the "Now it's one call" section right below — no separate thumbnail assets
needed.

Optional 7th+ assets from the brief (`scanned-page.png`, `process-diagram.png`,
`appeal-notice.png`) aren't wired into the component yet — add a 7th entry to
`SCATTER_ITEMS` and a matching CSS position if one lands.
