# BlobBoard

A board-style life and task tracker: animated blobs you can group, connect and tag. It installs as an app on Windows and Android (PWA); Dropbox sync is planned. **Start with [HANDOVER.md](HANDOVER.md)** (status, decisions, how it works); the full spec is in [DESIGN.md](DESIGN.md).

Live: https://georgedaveb.github.io/BlobBoard/

## Run locally (Windows)

From inside the `BlobBoard` folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/ (the app) or http://localhost:8000/tests/ (tests). Double-clicking `index.html` won't work: ES modules need a web server.

## Deploy

Push to `main`. GitHub Pages publishes within a minute or two.
