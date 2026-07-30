import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import require_key
from app.api.commute import router as commute_router
from app.api.places import router as places_router
from app.api.routes import router as api_router

app = FastAPI(
    title="Canary API",
    description="The change layer of the physical world — L4 serving surface.",
    version="0.1.0",
)

# CORS is now locked to known browser origins (was "*"). Override in prod via
# CANARY_CORS_ORIGINS (comma-separated). This only constrains browsers: the
# publishable/anon key is Origin-locked here, while partner keys are used
# server-to-server and send no Origin, so they are unaffected — which is exactly
# the boundary we want.
_default_origins = "https://canarylayer.com,https://www.canarylayer.com,http://localhost:5173,http://localhost:3000"
_origins = [o.strip() for o in os.environ.get("CANARY_CORS_ORIGINS", _default_origins).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Every data endpoint requires an API key (anon for the map, partner for
# customers). /health stays open — it is outside these routers.
app.include_router(api_router, dependencies=[Depends(require_key)])
app.include_router(commute_router, dependencies=[Depends(require_key)])
app.include_router(places_router, dependencies=[Depends(require_key)])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
