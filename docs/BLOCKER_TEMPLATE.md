# Blocker report

**Rule:** a source or step blocked for about **30 minutes** triggers this report and ONE coordinated
alternative. Do not keep silently retrying. Never invent data or report a download that did not succeed.

Copy, fill in, post in the team chat (and as a GitHub issue if it affects the contract):

```
BLOCKER - <owner: P1/P2/P3> - <short title>
Failing file/URL : <exact path or URL>
Attempted step   : <command or action, with versions>
Exact failure    : <error text / HTTP status / checksum mismatch, copied verbatim>
Time blocked     : <minutes>
Next bounded action: <one concrete thing, with a time box, e.g. "try documented official derivative X, 20 min">
Fallback if that fails: <e.g. "show reference unavailable", "keep demo corpus labeled">
Downstream can continue on fixtures? <yes/no - who is affected and how>
Contract change needed? <no / yes: field, endpoint, ID, unit - needs all 3 owners>
```

## Fallback ladder (from the integration brief)

| Problem | Allowed fallback | Never |
|---|---|---|
| Source blocked | bounded retry, then a documented official substitution agreed by the team | invent values, relabel another DEM as SRTM/LOLA/MOLA |
| Extraction delayed | UI/API keep running on labeled fixtures (`is_demo=true`, DEMO banner) | present fixtures as science |
| Chat blocked | deterministic evidence + DecisionRecord keep working | template text labeled as AI |
| Map imagery blocked | cards + evidence + readable service error | hide the failure |
| Hosting blocked | working local demo + recorded video | claim a dead public URL works |

## Example (resolved)

```
BLOCKER - P1 - Earth SRTM tiles not on P1 machine
Failing file/URL : data/raw/earth/*/*.SRTMGL1.hgt.zip
Attempted step   : analysis.build_candidates (real)
Exact failure    : DataUnavailableError: raw tiles missing; EARTHDATA_TOKEN not set
Next bounded action: P3 sends earth_raw_for_person1.zip (169 MB, SHA-256 in earth_sources.json)
Downstream can continue on fixtures? yes - backend DEMO_FIXTURES=true, frontend demo mode
Contract change needed? no
```
