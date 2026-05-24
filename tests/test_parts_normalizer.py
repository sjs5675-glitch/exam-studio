"""
Tests for equation.normalize_parts — Phase 2: Python normalizer.

Runs all fixtures from studio/tests/fixtures/parts_normalization/.
Two test suites:
  1. test_normalize_parts_fixture: input → normalize_parts → expected
  2. test_idempotent: normalize(normalize(x)) == normalize(x)
"""

import json
import os
import glob

import pytest

# equation.py lives one level up from this tests/ directory
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from equation import normalize_parts

# Fixture directory (relative to project root, matching spec path)
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE_DIR = os.path.join(_HERE, "studio", "tests", "fixtures", "parts_normalization")


def _fixture_paths():
    pattern = os.path.join(FIXTURE_DIR, "*.json")
    paths = sorted(glob.glob(pattern))
    return [p for p in paths if not p.endswith(os.sep + "index.json")]


def _fixture_id(path):
    return os.path.splitext(os.path.basename(path))[0]


@pytest.mark.parametrize("fixture_path", _fixture_paths(), ids=_fixture_id)
def test_normalize_parts_fixture(fixture_path):
    """normalize_parts(input.parts) == expected.parts for every fixture."""
    with open(fixture_path, encoding="utf-8") as f:
        fx = json.load(f)
    actual = normalize_parts(fx["input"]["parts"])
    assert actual == fx["expected"]["parts"], (
        f"Fixture '{fx['id']}' mismatch.\n"
        f"  Input:    {fx['input']['parts']}\n"
        f"  Expected: {fx['expected']['parts']}\n"
        f"  Actual:   {actual}"
    )


@pytest.mark.parametrize("fixture_path", _fixture_paths(), ids=_fixture_id)
def test_idempotent(fixture_path):
    """normalize_parts(normalize_parts(x)) == normalize_parts(x) for every fixture."""
    with open(fixture_path, encoding="utf-8") as f:
        fx = json.load(f)
    once = normalize_parts(fx["input"]["parts"])
    twice = normalize_parts(once)
    assert once == twice, (
        f"Fixture '{fx['id']}' is NOT idempotent.\n"
        f"  normalize(x):    {once}\n"
        f"  normalize(normalize(x)): {twice}"
    )
