# BlobBoard

A board-style life and task tracker: animated blobs you can group (drop one into another), connect with lines and arrows, select many at once, and describe with styled text. It installs as an app on Windows and Android (PWA). Pictures, tags, multiple canvases, export and Dropbox sync are planned.

**Start with [HANDOVER.md](HANDOVER.md)** (status, decisions, how the code works, how to move the project); the full spec is in [DESIGN.md](DESIGN.md); AI assistants also read [CLAUDE.md](CLAUDE.md).

Live: https://georgedaveb.github.io/BlobBoard/ · Tests: https://georgedaveb.github.io/BlobBoard/tests/

Plain HTML/CSS/JavaScript (ES modules) — no build step, no dependencies.

## Run locally (Windows)

From inside the `BlobBoard` folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/ (the app) or http://localhost:8000/tests/ (tests — must say ALL PASSED). Double-clicking `index.html` won't work: ES modules need a web server.

## Deploy

1. Bump `APP_VERSION` in `js/version.js` (shown in ⚙ Settings).
2. Commit and push to `main`. GitHub Pages publishes within a minute or two (sometimes longer — see HANDOVER gotcha 15).
3. Check the live `/tests/` page.
