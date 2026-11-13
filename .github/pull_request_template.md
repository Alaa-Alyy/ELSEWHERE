## What and why

<!-- One or two sentences. Which owner area (P1 analysis / P2 backend+contracts / P3 frontend / docs)? -->

## Merge checklist (v2.0)

- [ ] Only my owned paths changed (or the other owner agreed in chat).
- [ ] No renamed fields, IDs, endpoints or units; versions stay 2.0.
- [ ] No raw rasters, `.env`, keys or tokens in the diff.
- [ ] `python scripts/contract_check.py --demo` passes (and real mode if `data/processed/` changed).
- [ ] Tests pass for my area: `pytest tests/analysis` / `pytest tests/backend tests/integration` / `cd frontend && npm test`.
- [ ] Frontend changes: `npm run build && npm run check:bundle` pass.
- [ ] Metric/source/config change? Then the corpus was rebuilt and the new `corpus_version` announced.
- [ ] Demo data stays labeled (`is_demo=true`, DEMO banner); nothing demo is presented as real.
