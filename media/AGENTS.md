# AGENTS.md — media

Package rules for `media/` (`hlmedia`, lesson videos). The root `AGENTS.md` (workflow, risk tiers, `node scripts/check.mjs`) applies too.

- Runs only on the project owner's private GPU machine: never install CUDA torch or run `hlmedia` on a teammate laptop. `node scripts/check.mjs` checks media only where `media/.venv` exists, and CI does not check it, so the GPU machine's owner runs `node scripts/check.mjs media` before a media PR merges.
- Setup: `uv venv .venv && VIRTUAL_ENV=.venv uv pip install --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match -e ".[dev]"`; tests: `.venv/bin/pytest -q`; lint: `.venv/bin/ruff check src tests`.
- `media` pins torch 2.8 / CUDA 12.8 because `habibi-tts` (NAMAA inference) requires torch<2.9. NAMAA and its Habibi Najdi reference clip are CC BY-NC-SA (non-commercial).
- Clips are human-made and live in `clips/` (requested in `CLIP-REQUESTS.md`, catalogued in `library.json`); there is no video generator. CATT tashkeel is applied inside the TTS step only and never shown. Courier videos are vertical, partner videos horizontal. Renders are serialized on one GPU queue.
