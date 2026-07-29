// Map-wide constants — the numbers every map module keys off. One home for the
// SF framing and the zoom thresholds so the camera, the paint fades, the marker
// gates and the click routing can never drift apart.

// The San Francisco framing: where the map opens, where "SF"/"Back to San
// Francisco" fly home to, and the screen-space point the offscreen test projects.
export const SF_CENTER: [number, number] = [-122.44, 37.75]
export const SF_ZOOM = 12.3

// ONE LAYER, ZOOM AS THE AXIS. At city scale you care about
// areas — the trajectory choropleth. Fly past STREET_ZOOM and the story becomes
// individual permits and businesses: the choropleth melts to a faint tint while
// the markers fade up.
export const STREET_ZOOM = 14

// Routine "OTC alteration" permits are low-signal noise even at street zoom —
// reveal them only once the user is close enough for parcel detail to matter.
export const ALTERATION_MIN_ZOOM = 15
