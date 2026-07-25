import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from firecrawl import Firecrawl

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


@lru_cache
def get_client() -> Firecrawl:
    api_key = os.environ["FIRECRAWL_API_KEY"]
    return Firecrawl(api_key=api_key)
