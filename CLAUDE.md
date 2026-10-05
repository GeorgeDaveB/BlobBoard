# BlobBoard — rules for AI assistants

Start every session by reading `HANDOVER.md` (status, decision log, how it works, gotchas), then the relevant part of `DESIGN.md` (requirements R1–R33, choices C1–C14).

- Vanilla ES modules, no build step, no external libraries. Only `core/store.js` actions change data.
- Every change: code + tests (for logic) + a dated line in HANDOVER.md's decision log + DESIGN.md if a requirement changed (back DESIGN.md up first). Update HANDOVER "Status" and test count.
- State selectors in CSS use direct-child chains (`.item.x > .item-jelly > .item-body > …`) — minis live inside parents.
- Verify with `tests/` (ALL PASSED) locally and on the live site after pushing; say what wasn't tested (real touch).
- Never read credentials. Push with `git push origin main` (repo-scoped token already stored). Commit email is set in repo config.

## Applied Learning
One bullet, ≤15 words, no explanation.

- Hidden browser pane: no rAF/ResizeObserver, throttled timers, no focus; use `tick()`, screenshots.

Bullet count: 1/30
