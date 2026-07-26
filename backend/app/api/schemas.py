"""
Canary L4 — the frozen API contract.

This module defines the JSON shape every consumer reads: the frontend (Kat),
the $29 "before you sign" report, the AI benchmark, and the future B2B / MCP
surface. Per CONTEXT.md, "the report IS the API response in a PDF costume" —
so this is one contract, not three.

Design rules baked into the types (all from CONTEXT.md design constraints):
  - GEOGRAPHY-AGNOSTIC. The spine is H3 (global by construction). No field
    assumes SF or California. Adding Oakland, Helsinki, or Tokyo changes data,
    never this schema.
  - FACTS CARRY CITATIONS. Every surfaced fact embeds a `Citation` (source +
    as-of date + record key). "Facts with citations" is a schema property here,
    not a rendering habit — which is exactly what makes output agent-legible
    and checkable.
  - NO QUALITY LABELS, NO PROTECTED-CLASS DATA. Trajectory is expressed as a
    signed, sourced number and a neutral direction enum (rising/declining/
    stable) — never "good/bad neighborhood." Nothing in this contract carries
    race/ethnicity/income or a proxy for them.

Changing a field here is a breaking change for every consumer. Add, don't
mutate; deprecate before removing.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, Field, model_validator


# --------------------------------------------------------------------------- #
#  Provenance — rides on every fact
# --------------------------------------------------------------------------- #
class Citation(BaseModel):
    """Where a fact came from and as of when. The unit of checkability."""

    source: str = Field(..., description="Dataset id, e.g. 'datasf_permits'.")
    source_as_of: date | None = Field(
        None, description="Publication/snapshot date of the file this came from."
    )
    record_key: str | None = Field(
        None, description="Native record id in the source system (e.g. permit number)."
    )
    record_url: str | None = Field(
        None, description="Deep link to the source record, when the source exposes one."
    )


# --------------------------------------------------------------------------- #
#  Categorisation — coarse buckets for display, raw type preserved
# --------------------------------------------------------------------------- #
class Category(str, Enum):
    """Coarse bucket for coloring/filtering. The raw `event_type` is kept too."""

    construction = "construction"  # permits, entitlements
    business = "business"          # POI open/close, license churn
    safety = "safety"              # crime, 311 friction
    housing = "housing"            # evictions, displacement pressure
    other = "other"


class Direction(str, Enum):
    """Neutral trajectory direction. Deliberately not 'good'/'bad'."""

    rising = "rising"
    declining = "declining"
    stable = "stable"


# --------------------------------------------------------------------------- #
#  ChangePoint — one thing that happened, at a place, in time (a map marker)
# --------------------------------------------------------------------------- #
class ChangePoint(BaseModel):
    """
    An atomic, located, dated change — the map-marker primitive and the
    building block of the report's "what's changing near here" list.
    """

    id: str = Field(..., description="Stable id: '<source>:<record_key>'.")
    lat: float
    lon: float
    h3_9: str = Field(..., description="H3 res-9 cell (global spine, ~350m).")

    category: Category
    event_type: str = Field(..., description="Raw type, e.g. 'permit_issued'.")
    event_time: date | None

    headline: str = Field(..., description="Human/agent-readable one-liner.")
    detail: str | None = Field(None, description="Free-text description from source.")
    value: float | None = Field(None, description="Magnitude when meaningful (e.g. $ cost).")
    units_delta: float | None = Field(None, description="Net housing units when meaningful.")

    citation: Citation


# --------------------------------------------------------------------------- #
#  Trajectory — the derivative. A metric's direction over a window.
# --------------------------------------------------------------------------- #
class SeriesPoint(BaseModel):
    period: date
    value: float
    n: int | None = None


class Trajectory(BaseModel):
    """
    One metric's movement over a window for one area. This is the 'derivative'
    the whole thesis sells — expressed as a sourced number + neutral direction,
    never a quality label.
    """

    metric: str = Field(..., description="e.g. 'permits_issued', 'biz_openings'.")
    area_id: str = Field(..., description="H3 cell or area id.")
    area_level: str = Field(..., description="'h3_9' | 'h3_8' | 'neighborhood'.")

    window_months: int
    direction: Direction
    slope_per_month: float | None = Field(
        None, description="OLS slope over the window (units of the metric / month)."
    )
    change_pct: float | None = Field(
        None, description="Percent change first→last window period, when defined."
    )
    latest_value: float | None = None
    series: list[SeriesPoint] = Field(
        default_factory=list, description="The underlying monthly series (for sparklines)."
    )
    citation: Citation


# --------------------------------------------------------------------------- #
#  AddressReport — the composite "before you sign" object
# --------------------------------------------------------------------------- #
class AreaRef(BaseModel):
    """Resolved location for a report query. All H3; display name is optional."""

    lat: float
    lon: float
    h3_9: str
    ring_k: int = Field(..., description="k-ring radius of hexes the report covers.")
    hex_ids: list[str] = Field(default_factory=list)
    display_name: str | None = Field(
        None, description="Human label (e.g. neighborhood). Display only — never computed on."
    )


class AddressReport(BaseModel):
    """
    The single-address answer to 'what is this place becoming?'. Same object the
    PDF report renders, the benchmark scores, and an agent reads over MCP.
    """

    query: AreaRef
    generated_at: datetime
    pipeline_version: str | None = None

    changes: list[ChangePoint] = Field(
        default_factory=list, description="Recent located changes within the ring."
    )
    trajectories: list[Trajectory] = Field(
        default_factory=list, description="Metric trajectories for the query area."
    )
    attributes: dict[str, object] = Field(
        default_factory=dict,
        description=(
            "Reference-layer attributes for the query hex (flood zone, fire "
            "hazard, school area, parking regime…). Dynamic pass-through of the "
            "areas table's non-spine columns — populates automatically as the "
            "pipeline stages each reference layer (data contract pattern 3)."
        ),
    )
    attributes_area: str | None = Field(
        default=None,
        description=(
            "Neighborhood the attribute facts describe (resolved via the H3 "
            "spine, which uses different boundaries than the map polygons — "
            "surface this so scope is explicit near edges)."
        ),
    )
    sources: list[Citation] = Field(
        default_factory=list, description="Distinct sources contributing to this report."
    )


# --------------------------------------------------------------------------- #
#  Discovery — data-driven so new metros/metrics need no schema change
# --------------------------------------------------------------------------- #
class MetricInfo(BaseModel):
    metric: str
    category: Category
    area_levels: list[str]
    period_min: date | None
    period_max: date | None


class Catalog(BaseModel):
    """Machine-readable capability list. Agent-legible discovery endpoint."""

    metrics: list[MetricInfo]
    area_levels: list[str]
    coverage_note: str


# --------------------------------------------------------------------------- #
#  Write side — user contributions (the moat). Comes IN from the frontend; the
#  backend is the only thing that persists it (to Supabase). No keys client-side.
# --------------------------------------------------------------------------- #
class ContributionIn(BaseModel):
    h3_9: str | None = None
    lat: float | None = None
    lon: float | None = None
    place_label: str | None = None
    moving_out: bool | None = None
    ratings: dict[str, float] = Field(default_factory=dict)
    comment: str | None = None
    session_id: str | None = None
    # Structured give-to-get answers (exit-interview tags, block knowledge,
    # directional calibration). Free-form JSON — schema-on-read, like events.attrs.
    answers: dict[str, object] | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "ContributionIn":
        # An all-defaults body ({}) is not a contribution — found the hard way
        # when an API probe 201'd an empty row into the store.
        if not (self.place_label or self.ratings or self.comment or self.answers):
            raise ValueError("contribution must include a place_label, ratings, comment, or answers")
        return self


# --------------------------------------------------------------------------- #
#  Resident layer — the READ side of the moat. k-anonymised (n ≥ 3) aggregates
#  only; raw reviews are unreadable by design (RLS has no SELECT policy).
# --------------------------------------------------------------------------- #
class ResidentAreaAgg(BaseModel):
    """One area's aggregated resident reviews (per-area view, k ≥ 3)."""

    place_label: str
    n_reviews: int
    avg_safety: float | None = None
    avg_noise: float | None = None
    avg_trajectory: float | None = None


class ResidentHexAgg(BaseModel):
    """One hex's aggregated resident reviews (per-h3_9 view, k ≥ 3)."""

    h3_9: str
    neighborhood: str | None = Field(None, description="Display name, joined from the spine.")
    n_reviews: int
    avg_safety: float | None = None
    avg_noise: float | None = None
    avg_trajectory: float | None = None


# --------------------------------------------------------------------------- #
#  Ask Canary — intent in, grounded answer + map actions out. The consumer face
#  of the B2B grounding feed (rate-limited free tier).
# --------------------------------------------------------------------------- #
class AskIn(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)
    history: list[dict] = Field(
        default_factory=list,
        description="Prior turns [{role: user|assistant, content}], last 6 kept.",
    )
    mission: str | None = Field(
        None, description="moving | buying | opening_business | exploring — frames every answer.")
    context: dict | None = Field(
        None,
        description=(
            "Where the user is asking FROM (the PlaceCard scope): "
            "{scope: city|neighborhood|spot|record, nhood?, lat?, lon?, record_id?}. "
            "Focuses the grounding on that area without breaking the cached city block."
        ),
    )


class AskOut(BaseModel):
    """Curated generative UI: the model composed these blocks from the blessed
    registry; the server hydrated every chartable number from DuckDB."""

    blocks: list[dict] = Field(
        default_factory=list,
        description="answer{md} | rank_map{chips} | flyto{neighborhood} | "
                    "compare{areas,metrics,series} | residents{area,n_reviews,…}",
    )
    followups: list[str] = Field(default_factory=list)
    grounded_on: dict = Field(default_factory=dict)
    model: str = ""


class ResidentLayer(BaseModel):
    """The unlockable give-to-get layer. Empty lists = not enough reviews yet
    (each group needs n ≥ 3 before it becomes visible — the k-anonymity floor)."""

    areas: list[ResidentAreaAgg] = Field(default_factory=list)
    hexes: list[ResidentHexAgg] = Field(default_factory=list)
    k_floor: int = Field(3, description="Minimum reviews per group before it appears.")
