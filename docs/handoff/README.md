# Evil Eye V2 — Claude Code handoff

Drop this folder into (or next to) your existing V1 repo, then in Claude Code say:

"Build Evil Eye V2 per MASTER PROMPT.md, visually matching
design-reference/Evil Eye V2 Dark.dc.html (open it in a browser to see the
live app — every button, timer, and flow works). DECISIONS.md is the short
list of locked product decisions. Use the existing .env from my V1 app at
<path> — adapt to its variable names. V1 code is reference only; this is a
clean rebuild. Build SIMULATED mode first so it runs end-to-end with zero keys."

Contents:
- MASTER PROMPT.md — full build spec (screens, pipeline, data model, integrations)
- design-reference/Evil Eye V2 Dark.dc.html + support.js — the approved interactive design
- DECISIONS.md — locked product rules in short form
