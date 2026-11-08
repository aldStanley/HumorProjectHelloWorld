#!/bin/bash
# Keep the dev server alive: restarts it whenever it exits, with a short
# backoff so a boot-loop (e.g. syntax error in next.config) doesn't spin.
# Run this in a regular terminal tab — NOT inside a Claude Code session,
# whose background processes are killed when the session ends.
cd "$(dirname "$0")/.." || exit 1

while true; do
  echo "[dev-forever] starting dev server at $(date)"
  npm run dev
  echo "[dev-forever] dev server exited at $(date); restarting in 3s (ctrl-C to stop)"
  sleep 3
done
