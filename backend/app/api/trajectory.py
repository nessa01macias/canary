"""
Turn a monthly metric series into a neutral trajectory (slope + direction).

This is the 'derivative' the thesis sells. It is computed at read time from the
L3 metrics table (exactly the read pattern the architecture doc intends). Output
is a signed, sourced number and a neutral direction enum — never a quality label.
"""

from __future__ import annotations

from .schemas import Direction, SeriesPoint, Trajectory
from .db import category_for_metric  # noqa: F401 (re-exported for callers)


def _ols_slope(values: list[float]) -> float | None:
    """Least-squares slope over evenly spaced periods (x = 0,1,2,…)."""
    n = len(values)
    if n < 2:
        return None
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(values) / n
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom == 0:
        return None
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, values))
    return num / denom


def _direction(slope: float | None, series_span: float) -> Direction:
    if slope is None:
        return Direction.stable
    # Stable band: movement smaller than ~5% of the series' own scale per month.
    threshold = 0.05 * (series_span if series_span > 0 else 1.0)
    if slope > threshold:
        return Direction.rising
    if slope < -threshold:
        return Direction.declining
    return Direction.stable


def build_trajectory(
    metric: str,
    area_id: str,
    area_level: str,
    rows: list[dict],
    citation,
) -> Trajectory:
    """`rows` is the chronological metric series (period, value, n)."""
    series = [
        SeriesPoint(period=r["period"], value=float(r["value"] or 0), n=r.get("n"))
        for r in rows
    ]
    values = [p.value for p in series]

    slope = _ols_slope(values)
    span = (max(values) - min(values)) if values else 0.0
    latest = values[-1] if values else None

    change_pct = None
    if len(values) >= 2 and values[0] != 0:
        change_pct = (values[-1] - values[0]) / abs(values[0]) * 100.0

    return Trajectory(
        metric=metric,
        area_id=area_id,
        area_level=area_level,
        window_months=len(series),
        direction=_direction(slope, span),
        slope_per_month=slope,
        change_pct=change_pct,
        latest_value=latest,
        series=series,
        citation=citation,
    )
