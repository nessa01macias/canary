// Rescue hatch: when SF drifts out of frame, a bottom-center button flies the
// camera back to the lit-up city. Mirrors the "SF" map control but is
// impossible to miss for anyone lost on the globe.

type Props = {
  show: boolean
  onRecenter: () => void
}

export function RecenterFab({ show, onRecenter }: Props) {
  return (
    <button
      type="button"
      className={`recenter-fab${show ? ' show' : ''}`}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={onRecenter}
    >
      <span className="recenter-fab-icon" aria-hidden>⌖</span>
      Back to San Francisco
    </button>
  )
}
