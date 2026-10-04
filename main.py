"""Entry point for hosts started with `uvicorn main:app` (e.g. an existing Render
service). Same app as `uvicorn app:app`."""

from app import app  # noqa: F401
