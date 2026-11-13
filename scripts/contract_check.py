"""Merge gate: validate processed data + contract examples against contracts/schema-v2.json.

    python scripts/contract_check.py                 # real corpus: data/processed (no is_demo allowed)
    python scripts/contract_check.py --demo          # demo corpus: data/processed/demo (all is_demo)
    python scripts/contract_check.py --allow-partial # real mode before Earth corpus exists (references only)

Complements Person 1's `python -m analysis.validate_outputs` (scientific gates). This script checks
the shared CONTRACT: versions, IDs, envelopes, finite metrics, histogram sums, source registry
resolution, and that fixtures never appear in real mode. Exit 0 = pass.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

try:
    import jsonschema
except ImportError:  # pragma: no cover
    sys.exit("pip install jsonschema  (listed in backend/requirements.txt)")

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts" / "schema-v2.json").read_text(encoding="utf-8"))
CAND_RE = re.compile(r"^earth-(khaybar|pinacate|death-valley)-r(0[0-8])-c(0[0-8])$")
PARENTS = {"earth-khaybar", "earth-pinacate", "earth-death-valley"}
REFERENCES = {"moon-south-pole-sector", "mars-jezero"}
EXAMPLE_DEFS = {
    "health.json": "HealthResponse", "references.json": "ListEnvelope", "parents.json": "ListEnvelope",
    "sources.json": "ListEnvelope", "candidate.json": "CandidateResponse", "rankings.json": "RankingResponse",
    "decision_request.json": "DecisionRequest", "decision.json": "DecisionRecord",
    "chat_request.json": "ChatRequest", "chat_response.json": "ChatResponse",
}


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.notes: list[str] = []

    def err(self, msg: str):
        self.errors.append(msg)

    def note(self, msg: str):
        self.notes.append(msg)


def strict_load(path: Path):
    def bad(x):
        raise ValueError(f"non-standard JSON constant {x} (NaN/Infinity are forbidden)")
    return json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=bad)


def validator(defn: str):
    """Validator for one named definition ($defs entry or top-level payload type)."""
    if defn in SCHEMA["$defs"]:
        sub = {"$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{defn}"}
    else:
        sub = {"$defs": SCHEMA["$defs"], **SCHEMA["properties"][defn]}
    return jsonschema.Draft202012Validator(sub)


def schema_errors(defn: str, obj) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
            for e in validator(defn).iter_errors(obj)][:5]


def finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_record(rep: Report, rec: dict, kind: str, demo: bool, registry: set[str]):
    rid = rec.get("id", "<no id>")
    for e in schema_errors("regionRecord", rec):
        rep.err(f"{kind} {rid}: {e}")
    if rec.get("kind") != kind:
        rep.err(f"{rid}: kind {rec.get('kind')!r} != {kind}")
    if kind == "candidate" and not CAND_RE.match(rid):
        rep.err(f"{rid}: candidate ID does not match earth-<parent>-rNN-cNN")
    if kind == "candidate" and rec.get("parent_id") not in PARENTS:
        rep.err(f"{rid}: unknown parent_id {rec.get('parent_id')!r}")
    a = rec.get("analysis", {})
    if bool(a.get("is_demo")) != demo:
        rep.err(f"{rid}: is_demo={a.get('is_demo')} in {'demo' if demo else 'REAL'} mode"
                + ("" if demo else "  <-- fixture leakage"))
    m = rec.get("metrics")
    if kind != "parent" and a.get("status") == "valid":
        h = (m or {}).get("slope_histogram")
        if not (isinstance(h, list) and len(h) == 8 and all(finite(x) and 0 <= x <= 1 for x in h)):
            rep.err(f"{rid}: valid record needs 8 finite histogram probabilities")
        elif abs(sum(h) - 1.0) > 1e-6:
            rep.err(f"{rid}: histogram sums to {sum(h):.8f}, not 1")
        for k in ("relief_p95_p05_m", "local_variation_m"):
            if not finite((m or {}).get(k)):
                rep.err(f"{rid}: valid record has non-finite {k}")
        if not finite(a.get("valid_fraction")) or a["valid_fraction"] < 0.95:
            rep.err(f"{rid}: valid record with valid_fraction {a.get('valid_fraction')} < 0.95")
    if a.get("status") == "invalid" and not (a.get("reasons") or rec.get("limitations")):
        rep.err(f"{rid}: invalid record without a reason")
    if kind == "candidate" and rec.get("body") != "earth":
        rep.err(f"{rid}: candidate body must be earth")
    if kind == "reference" and "never draw" not in str(rec.get("coordinate_convention", "")).lower() \
            and "never drawn" not in str(rec.get("coordinate_convention", "")).lower():
        rep.note(f"{rid}: coordinate_convention does not say it must never be drawn on Earth")
    if kind == "candidate":
        ring = (rec.get("footprint") or {}).get("coordinates", [[]])[0]
        if len(ring) < 5 or ring[0] != ring[-1] or not all(-180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in ring):
            rep.err(f"{rid}: footprint is not a closed WGS84 [lon,lat] ring")
    missing = set(rec.get("source_ids", [])) - registry
    if missing and not demo:
        rep.err(f"{rid}: source_ids not in data/sources registry: {sorted(missing)}")


def check_corpus(rep: Report, data_dir: Path, demo: bool, allow_partial: bool):
    registry = set()
    for p in sorted((ROOT / "data" / "sources").glob("*_sources.json")):
        doc = strict_load(p)
        for s in doc.get("items", []):
            for e in schema_errors("sourceRecord", s):
                rep.err(f"{p.name} {s.get('id')}: {e}")
            registry.add(s["id"])
    rep.note(f"source registry: {len(registry)} records")

    loaded = {}
    for name, kind in (("references", "reference"), ("parents", "parent"), ("candidates", "candidate")):
        p = data_dir / f"{name}.json"
        if not p.exists():
            (rep.note if allow_partial and name != "references" else rep.err)(f"{p.relative_to(ROOT)} missing")
            continue
        try:
            doc = strict_load(p)
        except ValueError as exc:
            rep.err(f"{p.name}: {exc}")
            continue
        if doc.get("schema_version") != "2.0":
            rep.err(f"{p.name}: schema_version {doc.get('schema_version')!r} != '2.0'")
        items = doc.get("items", [])
        for rec in items:
            check_record(rep, rec, kind, demo, registry)
        loaded[name] = items

    ids = {r["id"] for r in loaded.get("references", [])}
    if loaded.get("references") is not None and ids != REFERENCES:
        rep.err(f"references.json ids {sorted(ids)} != {sorted(REFERENCES)}")
    if "parents" in loaded and {r["id"] for r in loaded["parents"]} != PARENTS:
        rep.err("parents.json must contain exactly the 3 frozen parents")
    if "candidates" in loaded:
        cands = loaded["candidates"]
        if len(cands) != 243:
            rep.err(f"candidates.json has {len(cands)} planned windows, expected 243 (9x9 x 3)")
        if len({c['id'] for c in cands}) != len(cands):
            rep.err("duplicate candidate IDs")
        valid = sum(c["analysis"]["status"] == "valid" for c in cands)
        rep.note(f"candidates: 243 planned / {valid} valid / {len(cands) - valid} rejected")
    man = data_dir / "search_manifest.json"
    if man.exists():
        m = strict_load(man)
        if not str(m.get("corpus_version", "")).startswith("sha256:"):
            rep.err("search_manifest.json: corpus_version is not a sha256 digest")
        if bool(m.get("is_demo")) != demo:
            rep.err(f"search_manifest.json is_demo={m.get('is_demo')} in {'demo' if demo else 'REAL'} mode")
    elif not allow_partial:
        rep.err(f"{man.relative_to(ROOT)} missing")


def check_examples(rep: Report):
    ex = ROOT / "contracts" / "examples"
    for fname, defn in EXAMPLE_DEFS.items():
        p = ex / fname
        if not p.exists():
            rep.err(f"contracts/examples/{fname} missing")
            continue
        for e in schema_errors(defn, strict_load(p)):
            rep.err(f"contracts/examples/{fname}: {e}")
    errs = strict_load(ex / "errors.json")
    for k, v in errs.items():
        for e in schema_errors("ErrorEnvelope", v):
            rep.err(f"contracts/examples/errors.json[{k}]: {e}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="validate data/processed/demo (all is_demo=true)")
    ap.add_argument("--allow-partial", action="store_true", help="real mode: tolerate missing Earth corpus")
    ap.add_argument("--data-dir", type=Path, default=None)
    a = ap.parse_args(argv)
    data_dir = a.data_dir or (ROOT / "data" / "processed" / ("demo" if a.demo else ""))
    rep = Report()
    check_corpus(rep, data_dir.resolve(), a.demo, a.allow_partial)
    check_examples(rep)
    mode = "DEMO" if a.demo else "REAL" + (" (partial allowed)" if a.allow_partial else "")
    print(f"contract_check v2.0 - mode {mode} - {data_dir}")
    for n in rep.notes:
        print(f"  note: {n}")
    for e in rep.errors[:60]:
        print(f"  FAIL: {e}")
    if len(rep.errors) > 60:
        print(f"  ... {len(rep.errors) - 60} more failures")
    print("RESULT:", "PASS" if not rep.errors else f"FAIL ({len(rep.errors)} problems)")
    return 0 if not rep.errors else 1


if __name__ == "__main__":
    sys.exit(main())
