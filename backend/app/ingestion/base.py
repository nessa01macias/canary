"""Shared ingestion foundation: dated, immutable, provenance-stamped snapshots.

Every source Canary acquires goes through here so that the date discipline is
enforced structurally, not per-module. The core rule (see the `dates-on-all-raw-data`
principle): every raw artifact carries TWO distinct dates —

  - `source_as_of`  : when the SOURCE considers the data current (its own freshness --
                      an ArcGIS layer's lastEditDate, a Socrata rowsUpdatedAt, an
                      HTTP Last-Modified, a published snapshot date, or -- only when the
                      source exposes nothing -- the fetch date for a genuinely live pull)
  - `fetched_at`    : when WE pulled it

Re-fetching never makes stale source data fresher; the snapshot directory is named by
`source_as_of`, so re-running an ingestion for an unchanged source is idempotent and a
new directory only appears when the source itself has actually advanced.

Layout:
  data/raw/<source>/<source_as_of>/<files...>
  data/raw/<source>/<source_as_of>/metadata.json   (provenance for the whole snapshot)
  data/raw/manifest.jsonl                           (append-only index of every file pulled)
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

import requests

# Temporal shape drives how the mapping/staging layer (L1+) turns a source into change:
#   event_stream      -> records with a native event_time; count per area per period
#   recurring_snapshot-> full state dumps; change is DERIVED by diffing consecutive releases
#   reference_layer   -> quasi-static geography; spatial-join once per version
# (See the other chat's L0->L4 architecture; this classification is required per source.)
TemporalShape = Literal["event_stream", "recurring_snapshot", "reference_layer"]

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MANIFEST_PATH = RAW_DIR / "manifest.jsonl"

DEFAULT_TIMEOUT = 120
DEFAULT_HEADERS = {"User-Agent": "canary-data-engine/0.1 (+https://github.com/canary)"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today() -> date:
    return datetime.now(timezone.utc).date()


def append_manifest(entry: dict) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("a") as f:
        f.write(json.dumps(entry) + "\n")


@dataclass(frozen=True)
class SourceSpec:
    """Declarative description of one source. The registry is a list of these.

    Codifies the module protocol: every ingestion module exposes SPEC (a SourceSpec)
    and a fetch() that produces L0 (raw/<key>/<source_as_of>/ + metadata.json + manifest).
    stage() (L0 -> L1 parquet) is owned by the mapping/processing layer, not here.
    """

    key: str  # our L0 dir name, e.g. 'datasf_permits'
    name: str
    geography: str  # 'san_francisco' | 'california' | 'us'
    temporal_shape: TemporalShape
    cadence: str  # 'daily' | 'monthly' | 'annual' | 'per_election' | 'irregular' | 'continuous'
    fmt: str  # 'csv' | 'geojson' | 'zip' | 'geoparquet' | 'shapefile'
    license: str
    homepage: str
    canonical_source: str | None = None  # mapping-layer event `source` label, e.g. 'sf_permits'
    tier: str | None = None  # taxonomy tier ref, e.g. 'T6.1'
    requires_auth: bool = False  # needs a key/token the fetch can't do headlessly
    notes: str | None = None


@dataclass
class FileResult:
    name: str
    url: str | None
    status: str = "error"
    output_path: str | None = None
    bytes: int | None = None
    sha256: str | None = None
    error: str | None = None
    fetched_at: str = field(default_factory=now_iso)


class Snapshot:
    """One dated, immutable snapshot of a single source.

    Usage:
        snap = Snapshot("calfire_fhsz", source_as_of="2025-04-01", geography="california")
        snap.download("fhsz_sra.geojson", url)
        snap.write_json("fhsz_sra.geojson", feature_collection)
        snap.finalize(extra={"layer": "State Responsibility Area"})
    """

    def __init__(
        self,
        source: str,
        source_as_of: str,
        *,
        geography: str = "california",
        source_name: str | None = None,
        license: str | None = None,
        homepage: str | None = None,
    ) -> None:
        self.source = source
        self.source_as_of = source_as_of
        self.geography = geography
        self.source_name = source_name or source
        self.license = license
        self.homepage = homepage
        self.fetched_at = now_iso()
        self.dir = RAW_DIR / source / source_as_of
        self.dir.mkdir(parents=True, exist_ok=True)
        self._files: list[FileResult] = []

    # --- writing artifacts -------------------------------------------------

    def _record(self, result: FileResult) -> FileResult:
        self._files.append(result)
        append_manifest(
            {
                "source": self.source,
                "geography": self.geography,
                "source_as_of": self.source_as_of,
                "fetched_at": result.fetched_at,
                **asdict(result),
            }
        )
        marker = result.output_path or result.error
        print(f"  [{result.status}] {result.name} -> {marker}")
        return result

    def download(
        self, name: str, url: str, *, timeout: int = DEFAULT_TIMEOUT,
        headers: dict[str, str] | None = None,
    ) -> FileResult:
        result = FileResult(name=name, url=url)
        out_path = self.dir / name
        try:
            sha = hashlib.sha256()
            with requests.get(url, headers=headers or DEFAULT_HEADERS, timeout=timeout, stream=True) as resp:
                resp.raise_for_status()
                with out_path.open("wb") as f:
                    for chunk in resp.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
                        sha.update(chunk)
            result.status = "ok"
            result.output_path = str(out_path.relative_to(DATA_DIR))
            result.bytes = out_path.stat().st_size
            result.sha256 = sha.hexdigest()
        except requests.RequestException as exc:
            result.error = str(exc)
        return self._record(result)

    def write_bytes(self, name: str, data: bytes) -> FileResult:
        out_path = self.dir / name
        out_path.write_bytes(data)
        return self._record(
            FileResult(
                name=name,
                url=None,
                status="ok",
                output_path=str(out_path.relative_to(DATA_DIR)),
                bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
            )
        )

    def record_file(self, name: str, *, url: str | None = None) -> FileResult:
        """Register a file already written into the snapshot dir (e.g. by DuckDB COPY)."""
        out_path = self.dir / name
        if not out_path.exists():
            return self._record(FileResult(name=name, url=url, error="file not found after write"))
        data = out_path.read_bytes()
        return self._record(
            FileResult(
                name=name, url=url, status="ok",
                output_path=str(out_path.relative_to(DATA_DIR)),
                bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
            )
        )

    def write_json(self, name: str, obj: Any, *, source_url: str | None = None) -> FileResult:
        data = json.dumps(obj).encode("utf-8")
        out_path = self.dir / name
        out_path.write_bytes(data)
        return self._record(
            FileResult(
                name=name,
                url=source_url,
                status="ok",
                output_path=str(out_path.relative_to(DATA_DIR)),
                bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
            )
        )

    # --- provenance --------------------------------------------------------

    def finalize(self, *, extra: dict | None = None) -> Path:
        try:
            age_days = (today() - date.fromisoformat(self.source_as_of)).days
        except ValueError:
            age_days = None
        metadata = {
            "source": self.source,
            "source_name": self.source_name,
            "geography": self.geography,
            "license": self.license,
            "homepage": self.homepage,
            "source_as_of": self.source_as_of,
            "fetched_at": self.fetched_at,
            "data_age_days_at_fetch": age_days,
            "note": (
                "source_as_of is the source's OWN freshness; re-fetching does not make it "
                "newer. A new snapshot dir appears only when source_as_of advances."
            ),
            "files": [asdict(f) for f in self._files],
        }
        if extra:
            metadata.update(extra)
        meta_path = self.dir / "metadata.json"
        meta_path.write_text(json.dumps(metadata, indent=2))
        ok = sum(1 for f in self._files if f.status == "ok")
        print(f"  metadata.json written ({ok}/{len(self._files)} files ok, as_of={self.source_as_of})")
        return meta_path


# --- source-freshness probes (determine source_as_of without downloading) ----


def http_last_modified(url: str, *, timeout: int = 30) -> date | None:
    """HTTP Last-Modified as a date, for plain file downloads."""
    try:
        resp = requests.head(url, headers=DEFAULT_HEADERS, timeout=timeout, allow_redirects=True)
        lm = resp.headers.get("Last-Modified")
        if lm:
            return datetime.strptime(lm, "%a, %d %b %Y %H:%M:%S %Z").date()
    except (requests.RequestException, ValueError):
        pass
    return None


def arcgis_layer_as_of(layer_url: str, *, timeout: int = 30) -> date | None:
    """Read an ArcGIS layer's editingInfo.lastEditDate (epoch ms) as its freshness date."""
    try:
        resp = requests.get(
            layer_url, params={"f": "json"}, headers=DEFAULT_HEADERS, timeout=timeout
        )
        resp.raise_for_status()
        info = resp.json().get("editingInfo") or {}
        last_edit = info.get("lastEditDate")
        if last_edit:
            return datetime.fromtimestamp(last_edit / 1000, tz=timezone.utc).date()
    except (requests.RequestException, ValueError, KeyError):
        pass
    return None


# --- ArcGIS REST FeatureServer/MapServer paginated GeoJSON fetch --------------


def fetch_arcgis_geojson(
    layer_url: str,
    *,
    where: str = "1=1",
    out_fields: str = "*",
    page_size: int = 1000,
    timeout: int = DEFAULT_TIMEOUT,
    max_records: int | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> dict:
    """Fetch every feature from an ArcGIS REST layer as one GeoJSON FeatureCollection.

    Handles the server-side transfer cap (usually 1000-2000 records) by paging with
    resultOffset until the server stops returning full pages. `layer_url` is the layer
    endpoint (e.g. https://.../FeatureServer/0), NOT the /query path.
    `bbox` = (W, S, E, N) in WGS84 restricts to an intersecting envelope (for large
    national layers like FEMA NFHL where we only want one metro).
    """
    query_url = layer_url.rstrip("/") + "/query"
    features: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": out_fields,
            "f": "geojson",
            "outSR": 4326,
            "resultOffset": offset,
            "resultRecordCount": page_size,
        }
        if bbox is not None:
            params.update({
                "geometry": ",".join(str(c) for c in bbox),
                "geometryType": "esriGeometryEnvelope",
                "inSR": 4326,
                "spatialRel": "esriSpatialRelIntersects",
            })
        resp = requests.get(query_url, params=params, headers=DEFAULT_HEADERS, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
        batch = payload.get("features", [])
        features.extend(batch)
        exceeded = payload.get("properties", {}).get("exceededTransferLimit") or payload.get(
            "exceededTransferLimit"
        )
        if max_records and len(features) >= max_records:
            features = features[:max_records]
            break
        if len(batch) < page_size and not exceeded:
            break
        if not batch:
            break
        offset += len(batch)
    return {"type": "FeatureCollection", "features": features}


def snapshot_exists(source: str, source_as_of: str) -> bool:
    """True if a finalized snapshot dir for this source+as_of already exists.

    Lets ingestions be idempotent and date-driven: skip the pull when the source
    hasn't advanced since last time.
    """
    return (RAW_DIR / source / source_as_of / "metadata.json").exists()


# --- Socrata (DataSF and other Socrata-hosted portals) -----------------------


def socrata_as_of(domain: str, resource_id: str, *, timeout: int = 30) -> date | None:
    """A Socrata dataset's own freshness: rowsUpdatedAt from its view metadata."""
    try:
        resp = requests.get(
            f"https://{domain}/api/views/{resource_id}.json",
            headers=DEFAULT_HEADERS,
            timeout=timeout,
        )
        resp.raise_for_status()
        ts = resp.json().get("rowsUpdatedAt")
        if ts:
            return datetime.fromtimestamp(ts, tz=timezone.utc).date()
    except (requests.RequestException, ValueError):
        pass
    return None


def socrata_bulk_csv_url(domain: str, resource_id: str) -> str:
    """Full-dataset streaming CSV export (not the 1000-row SODA default)."""
    return f"https://{domain}/api/views/{resource_id}/rows.csv?accessType=DOWNLOAD"


def socrata_bulk_geojson_url(domain: str, resource_id: str) -> str:
    """Full-dataset GeoJSON export -- for spatial datasets (polygon reference layers)."""
    return f"https://{domain}/api/views/{resource_id}/rows.geojson?accessType=DOWNLOAD"


# --- CKAN (data.ca.gov and other CKAN portals) -------------------------------


def ckan_package(portal: str, package_id: str, *, timeout: int = 30) -> dict | None:
    """Fetch a CKAN package (dataset) record, including its resource list.

    `portal` is the host, e.g. 'data.ca.gov'. CKAN resource download URLs often
    302-redirect to signed S3 URLs, so downloads must follow redirects (Snapshot.download
    does, via requests' default).
    """
    try:
        resp = requests.get(
            f"https://{portal}/api/3/action/package_show",
            params={"id": package_id},
            headers=DEFAULT_HEADERS,
            timeout=timeout,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("success"):
            return payload["result"]
    except (requests.RequestException, ValueError, KeyError):
        pass
    return None


def ckan_as_of(package: dict) -> date | None:
    """A CKAN dataset's own freshness: metadata_modified (fallback last resource change)."""
    stamp = package.get("metadata_modified")
    if not stamp:
        stamps = [r.get("last_modified") or r.get("metadata_modified") for r in package.get("resources", [])]
        stamps = [s for s in stamps if s]
        stamp = max(stamps) if stamps else None
    if stamp:
        try:
            return datetime.fromisoformat(stamp.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def arcgis_count(layer_url: str, *, where: str = "1=1", timeout: int = 30) -> int | None:
    try:
        resp = requests.get(
            layer_url.rstrip("/") + "/query",
            params={"where": where, "returnCountOnly": "true", "f": "json"},
            headers=DEFAULT_HEADERS,
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json().get("count")
    except (requests.RequestException, ValueError):
        return None
