# Canary API — FastAPI served by uvicorn.
# Serves the derived layer only (canary.duckdb, mounted read-only at runtime).
# The raw archive (data/raw) and the pipeline never enter this image.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Non-root, WITH a home dir so the DuckDB extension cache lives somewhere the
# runtime user can read.
RUN useradd --system --create-home canary
USER canary

# Pre-bake the H3 community extension into the image at BUILD time (build has
# network + a writable home). At runtime the DB is mounted read-only and the
# container has no writable extension dir, so `LOAD h3` must already be cached —
# otherwise the /api/report ring path (h3_grid_disk / h3_latlng_to_cell_string)
# 500s. Baking it here makes the runtime LOAD offline and instant.
RUN python -c "import duckdb; duckdb.connect().execute('INSTALL h3 FROM community; LOAD h3;')"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
