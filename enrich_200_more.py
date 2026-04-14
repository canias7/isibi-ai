#!/usr/bin/env python3
"""
Enrich the NEXT 200 thinnest spec files to production quality.

Skips the top 50 (already deep) and the bottom 100 (already enriched by
enrich_thin_specs.py), then takes the next 200 thinnest and enriches them
with: views, quick_filters, searchable_fields, row_actions, dashboard cards,
placeholder/help_text, default_sort.
"""

import json
import os
import sys
from collections import defaultdict

# Re-use all helpers and constants from the original enrichment script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enrich_thin_specs import (
    SPEC_DIR, score_spec, enrich_fields, enrich_validations,
    enrich_computed_fields, enrich_badge_colors, enrich_views,
    enrich_quick_filters, enrich_default_sort, enrich_searchable_fields,
    enrich_row_actions, enrich_dashboard, enrich_field_hints,
    enrich_fk_relationships,
)

SKIP_BOTTOM = 100   # already enriched (thinnest 100)
SKIP_TOP = 50       # already deep (richest 50)
BATCH_SIZE = 200    # next 200 to enrich


def main():
    print("=" * 70)
    print("SPEC ENRICHMENT TOOL — Batch 2: Next 200 thin specs")
    print("=" * 70)

    # 1. Scan all spec files and score them
    print("\n[1/4] Scanning all spec files...")
    spec_scores = []
    for fname in sorted(os.listdir(SPEC_DIR)):
        if not fname.endswith("_spec.json"):
            continue
        fpath = os.path.join(SPEC_DIR, fname)
        try:
            with open(fpath) as f:
                spec = json.load(f)
            score = score_spec(spec)
            spec_scores.append((score, fname, fpath))
        except Exception as e:
            print(f"  WARNING: Could not read {fname}: {e}")

    total_specs = len(spec_scores)
    print(f"  Scanned {total_specs} spec files")

    # 2. Sort by score ascending (thinnest first)
    spec_scores.sort(key=lambda x: x[0])

    # Skip bottom 100 (already enriched) and take next 200
    # Also skip top 50 (richest, already deep)
    available = spec_scores[SKIP_BOTTOM:]  # skip thinnest 100
    if SKIP_TOP > 0:
        available = available[:len(available) - SKIP_TOP]  # skip richest 50

    batch = available[:BATCH_SIZE]

    if not batch:
        print("  No specs to enrich in this range!")
        return

    print(f"\n[2/4] Identified {len(batch)} specs to enrich")
    print(f"  Score range: {batch[0][0]} — {batch[-1][0]}")
    print(f"  Skipped bottom {SKIP_BOTTOM} (already enriched), top {SKIP_TOP} (already deep)")
    print(f"  Thinnest in batch: {batch[0][1]} (score={batch[0][0]})")
    print(f"  Thickest in batch: {batch[-1][1]} (score={batch[-1][0]})")

    # 3. Enrich each spec
    print(f"\n[3/4] Enriching {len(batch)} specs...")
    stats = defaultdict(int)
    enriched_files = []

    for i, (score, fname, fpath) in enumerate(batch):
        with open(fpath) as f:
            spec = json.load(f)

        original_score = score
        changes = []

        for entity in spec.get("entities", []):
            n = enrich_fields(entity)
            if n:
                changes.append(f"+{n} fields")
            stats["fields_added"] += n

            n = enrich_validations(entity)
            if n:
                changes.append(f"+{n} validations")
            stats["validations_added"] += n

            n = enrich_computed_fields(entity)
            if n:
                changes.append(f"+{n} computed")
            stats["computed_added"] += n

            n = enrich_badge_colors(entity)
            if n:
                changes.append(f"+{n} badges")
            stats["badges_added"] += n

            n = enrich_views(entity)
            if n:
                changes.append("+views")
            stats["views_added"] += n

            n = enrich_quick_filters(entity)
            if n:
                changes.append("+quick_filters")
            stats["quick_filters_added"] += n

            n = enrich_default_sort(entity)
            if n:
                changes.append("+default_sort")
            stats["default_sort_added"] += n

            n = enrich_searchable_fields(entity)
            if n:
                changes.append("+searchable")
            stats["searchable_added"] += n

            n = enrich_row_actions(entity)
            if n:
                changes.append("+row_actions")
            stats["row_actions_added"] += n

            n = enrich_field_hints(entity)
            stats["hints_added"] += n

        n = enrich_fk_relationships(spec)
        if n:
            changes.append(f"+{n} FK")
        stats["fk_added"] += n

        n = enrich_dashboard(spec)
        if n:
            changes.append(f"+{n} dashboard cards")
        stats["dashboard_cards_added"] += n

        new_score = score_spec(spec)
        change_str = ", ".join(changes) if changes else "no changes needed"

        if (i + 1) % 20 == 0 or i < 5:
            print(f"  [{i+1:3d}/{len(batch)}] {fname:45s} score {original_score:3d} -> {new_score:3d}  ({change_str})")

        enriched_files.append((fname, fpath, spec, original_score, new_score))

    # 4. Write back
    print(f"\n[4/4] Writing enriched specs back to disk...")
    written = 0
    for fname, fpath, spec, old_score, new_score in enriched_files:
        with open(fpath, "w") as f:
            json.dump(spec, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written += 1

    print(f"  Written {written} files")

    # Summary
    print("\n" + "=" * 70)
    print("ENRICHMENT SUMMARY — Batch 2")
    print("=" * 70)
    print(f"  Specs scanned:            {total_specs}")
    print(f"  Specs enriched:           {written}")
    print(f"  Fields added:             {stats['fields_added']}")
    print(f"  FK relationships added:   {stats['fk_added']}")
    print(f"  Validations added:        {stats['validations_added']}")
    print(f"  Computed fields added:    {stats['computed_added']}")
    print(f"  Badge colors added:       {stats['badges_added']}")
    print(f"  Views configs added:      {stats['views_added']}")
    print(f"  Quick filters added:      {stats['quick_filters_added']}")
    print(f"  Default sorts added:      {stats['default_sort_added']}")
    print(f"  Searchable fields:        {stats['searchable_added']}")
    print(f"  Row actions added:        {stats['row_actions_added']}")
    print(f"  Dashboard cards added:    {stats['dashboard_cards_added']}")
    print(f"  Hints (placeholder/help): {stats['hints_added']}")
    print()

    # Show before/after scores for first 20
    print("BEFORE/AFTER SCORES (first 20):")
    print(f"  {'File':45s} {'Before':>8s} {'After':>8s} {'Delta':>8s}")
    print(f"  {'-'*45} {'-'*8} {'-'*8} {'-'*8}")
    for fname, fpath, spec, old_score, new_score in enriched_files[:20]:
        delta = new_score - old_score
        print(f"  {fname:45s} {old_score:8d} {new_score:8d} {'+' + str(delta):>8s}")

    print("\nDone!")


if __name__ == "__main__":
    main()
