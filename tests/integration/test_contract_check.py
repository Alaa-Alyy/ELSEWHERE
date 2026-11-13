import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import contract_check  # noqa: E402

DEMO = ROOT / "data" / "processed" / "demo"


def test_demo_corpus_passes():
    assert contract_check.main(["--demo"]) == 0


def test_real_references_only_pass_when_partial_allowed():
    assert contract_check.main(["--allow-partial"]) == 0


def test_fixture_leakage_into_real_mode_fails(tmp_path, capsys):
    d = tmp_path / "processed"
    shutil.copytree(DEMO, d)
    assert contract_check.main(["--data-dir", str(d)]) == 1
    assert "fixture leakage" in capsys.readouterr().out


def test_nan_and_bad_histogram_fail(tmp_path, capsys):
    d = tmp_path / "processed"
    shutil.copytree(DEMO, d)
    p = d / "candidates.json"
    doc = json.loads(p.read_text(encoding="utf-8-sig"))
    valid = [c for c in doc["items"] if c["analysis"]["status"] == "valid"]
    valid[0]["metrics"]["slope_histogram"][0] += 0.2
    text = json.dumps(doc).replace(json.dumps(valid[1]["metrics"]["relief_p95_p05_m"]), "NaN", 1)
    p.write_text(text, encoding="utf-8")
    assert contract_check.main(["--demo", "--data-dir", str(d)]) == 1
    out = capsys.readouterr().out
    assert "NaN" in out or "histogram sums" in out
