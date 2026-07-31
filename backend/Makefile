# Canary data pipeline. Raw acquisition (app/ingestion) is run separately/elsewhere;
# these targets only consume finalized raw snapshots.
ifeq ($(OS),Windows_NT)
PY := venv/Scripts/python.exe
else
PY := venv/bin/python
endif

.PHONY: ingest pipeline stage areas build trajectory

# Monthly capture -- MUST run at least monthly: Overture prunes old releases from S3,
# so a skipped month is history lost forever (see app/ingestion/overture.py).
# Idempotent: sources that haven't advanced are skipped.
ingest:
	$(PY) -m app.ingestion.datasf
	$(PY) -m app.ingestion.overture

pipeline: areas stage build trajectory   ## full refresh: spine, stage, rebuild db, score

trajectory:
	$(PY) -m app.pipeline.trajectory

publish-local:
	$(PY) -m app.pipeline.publish --local

publish:
	$(PY) -m app.pipeline.publish --push

# NOTE: daily automation lives in scripts/refresh.sh + com.canary.refresh.plist
# (app.ingestion.refresh orchestrates fetch -> pipeline -> publish -> freshness).
# These Make targets are the manual primitives it composes.

# The AI area benchmark: generate questions from the db, ask every LLM with a
# configured key (see app/benchmark/run.py for the env var names), score answers.
benchmark:
	$(PY) -m app.benchmark.generate
	$(PY) -m app.benchmark.run
	$(PY) -m app.benchmark.score

areas:
	$(PY) -m app.pipeline.areas

stage:
	$(PY) -m app.pipeline.stage

build:
	$(PY) -m app.pipeline.build
