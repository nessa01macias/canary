// The mission vocabulary — shared by the picker (tabs), the dock (placeholder
// voice), and the ask flow (framing). A mission is a LENS, not an onboarding
// step: it's changeable any time from the picker's tab row.

export const MAX_PICKS = 6

export const MISSIONS: { id: string; icon: string; label: string; placeholder: string }[] = [
  { id: 'moving', icon: '🏠', label: 'Moving here',
    placeholder: 'Where should I live? Ask, or type an address…' },
  { id: 'buying', icon: '🔑', label: 'Buying a home',
    placeholder: "What's approved to be built near…? Ask, or type an address…" },
  { id: 'opening_business', icon: '☕', label: 'Opening a business',
    placeholder: 'Where should the shop go? Ask, or type an address…' },
  { id: 'exploring', icon: '🧭', label: 'Just exploring',
    placeholder: 'Ask anything — “which neighborhoods are getting quieter?”' },
]

// Each mission's QUESTION, answered with its spotlight chips. Curated per
// QUESTION_MAP.md lead order; only chips in GROUNDED_TAGS — every pick must
// visibly move the map (a dead choice teaches the user not to choose).
export const MISSION_QUESTIONS: Record<string, { question: string; chips: string[] }> = {
  buying: {
    question: 'What would make or break the place?',
    chips: ['Good schools', 'Flood risk', 'New construction', 'Quiet', 'Low crime',
            'Housing stability', 'Tree canopy', 'Parking'],
  },
  moving: {
    question: 'What does a good street mean to you?',
    chips: ['Low crime', 'Quiet', 'Housing stability', 'Transit access',
            'Groceries & retail', 'Tree canopy', 'Fast emergency response', 'Good schools'],
  },
  opening_business: {
    question: 'What does the shop need around it?',
    chips: ['Business openings', 'Vacancy trend', 'Transit access', 'Groceries & retail',
            'Liquor & cannabis', 'Parking', 'Road projects', 'Away from industry'],
  },
}
