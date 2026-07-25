// Type-only stub so the build stays green while the ask feature lands.
// AskResult's shape is derived from AnswerStrip.tsx's usage — whoever implements
// the actual useAsk() hook here owns this file; extend, don't fork.

export type AskResult = {
  answer_md: string
  applied_chips: string[]
  neighborhoods: string[]
  followups: string[]
  grounded_on?: { as_of?: string }
}
