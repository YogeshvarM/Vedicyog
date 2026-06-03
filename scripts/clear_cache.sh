#!/usr/bin/env bash
# Clear application cache directory (expects to be run from repo root)
set -euo pipefail
CACHE_DIR="$(dirname "$0")/.."/cache
if [ -d "$CACHE_DIR" ]; then
  rm -rf "$CACHE_DIR"/*
  echo "Cache cleared"
else
  mkdir -p "$CACHE_DIR"
  echo "Cache directory created"
fi
