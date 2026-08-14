import { useEffect, useState } from 'react'
import { logLocalDataAnswer } from '../lib/localDataSignal'

// A small corner prompt, unrelated to the rest of the page's narrative —
// pure research input for a possible future consumer product: what
// hard-to-scrape local knowledge (hours, crowding, vibe, whatever) would
// visitors actually want. Appears once per session, past the fold so it
// never competes with the hero's own CTAs. Tag-input style: Enter turns
// whatever's typed into a removable chip (× on each one) instead of
// submitting immediately, so a visitor can correct a typo or drop an entry
// before committing to anything. "Send" sits on its own row below the chip
// field — it used to be the last item inside the (wrapping) chip row, but
// that meant its position jumped around depending on how many rows the
// chips happened to wrap onto, sometimes ending up mid-row right after the
// last chip instead of somewhere predictable. Only an explicit close (×)
// suppresses it for the rest of the session (sessionStorage, same dedupe
// pattern as gateEvents' logGateShown).
const DISMISS_KEY = 'canary_data_prompt_dismissed'
// One submission per session, per localDataSignal.ts's documented contract —
// enforced here (not just an unpersisted in-memory flag) so a page reload
// mid-session doesn't reopen the form for a second round of sends.
const SUBMITTED_KEY = 'canary_data_prompt_submitted'
const SCROLL_THRESHOLD = 0.9 // × window.innerHeight — roughly past the hero fold

export function LandingDataPrompt() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1',
  )
  const [submitted, setSubmitted] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem(SUBMITTED_KEY) === '1',
  )
  const [answer, setAnswer] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [sentCount, setSentCount] = useState(0)

  useEffect(() => {
    if (dismissed || submitted) return
    const onScroll = () => {
      if (window.scrollY > window.innerHeight * SCROLL_THRESHOLD) {
        setVisible(true)
        // Job done — nothing left for this listener to detect, and without
        // this it kept computing scrollY/innerHeight on every scroll event
        // for the rest of the session even after the prompt had appeared.
        window.removeEventListener('scroll', onScroll)
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [dismissed, submitted])

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  // Enter commits the current text to a chip — it does NOT submit. Nothing
  // is logged until "Send", so a chip added by mistake can still be removed.
  const commitChip = () => {
    const trimmed = answer.trim()
    if (!trimmed) return
    setTags((prev) => [...prev, trimmed])
    setAnswer('')
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitChip()
      return
    }
    // Backspace on an empty input deletes the chip behind the cursor —
    // same convention as Gmail's "To" field — instead of doing nothing.
    // Only fires when the input itself is already empty, so it never eats
    // a keystroke mid-word.
    if (e.key === 'Backspace' && answer === '' && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  const removeTag = (index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index))
  }

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    // Anything still sitting in the input counts too — hitting "Send"
    // shouldn't silently drop whatever you were mid-typing.
    const finalTags = answer.trim() ? [...tags, answer.trim()] : tags
    if (finalTags.length === 0) return
    finalTags.forEach((tag) => void logLocalDataAnswer(tag))
    setSentCount(finalTags.length)
    setTags([])
    setAnswer('')
    // One submission per session (see localDataSignal.ts) — persisted so a
    // reload mid-session doesn't reopen the form for a second round.
    sessionStorage.setItem(SUBMITTED_KEY, '1')
    setSubmitted(true)
  }

  if (dismissed || !visible) return null

  return (
    <div className="landing-data-prompt" role="complementary" aria-label="Quick question">
      <button
        className="landing-data-prompt-close"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        &times;
      </button>
      <p className="landing-data-prompt-question">
        What critical local data do you wish was online?
      </p>
      {submitted ? (
        <p className="landing-data-prompt-sent">
          Thanks — logged {sentCount} datapoint{sentCount === 1 ? '' : 's'}.
        </p>
      ) : (
        <>
          <p className="landing-data-prompt-hint">
            Request a datapoint: We&rsquo;re building infrastructure to capture local data.
          </p>
          <form onSubmit={send}>
            <div className="landing-data-prompt-chiprow">
              {tags.map((tag, i) => (
                // Index is fine here — chips can be removed (so index churns),
                // but this list is short-lived and re-rendered wholesale on every
                // add/remove; nothing depends on identity surviving a reorder.
                // eslint-disable-next-line react/no-array-index-key
                <span key={i} className="landing-data-prompt-chip" title={tag}>
                  <span className="landing-data-prompt-chip-text">{tag}</span>
                  <button
                    type="button"
                    className="landing-data-prompt-chip-remove"
                    onClick={() => removeTag(i)}
                    aria-label={`Remove ${tag}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={tags.length > 0 ? 'Add another…' : 'e.g. wait times for the metro'}
                aria-label="Your answer — press Enter to add"
                maxLength={500}
                className="landing-data-prompt-chip-input"
              />
            </div>
            <button
              type="submit"
              className="landing-data-prompt-submit"
              disabled={tags.length === 0 && !answer.trim()}
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  )
}
