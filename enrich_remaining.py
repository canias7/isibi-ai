#!/usr/bin/env python3
"""
Enrich ALL remaining thin specs to production quality.

Loads every spec file, checks whether it has already been enriched
(views, quick_filters, searchable_fields, row_actions, badge_colors,
dashboard cards, placeholder/help_text), and enriches any that are missing
pieces.  Idempotent — safe to run repeatedly.
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


def is_already_enriched(spec):
    """
    Return True only if EVERY entity in the spec already has all the
    enrichment markers we care about.  If any single entity is missing
    any marker, we return False so the whole spec gets re-processed
    (the individual enrich_* functions are themselves idempotent).
    """
    entities = spec.get("entities", [])
    if not entities:
        return True  # nothing to enrich

    for entity in entities:
        ui = entity.get("ui_config", {})
        lv = ui.get("list_view", {})

        if not lv.get("views"):
            return False
        if not lv.get("searchable_fields"):
            return False
        if not lv.get("row_actions"):
            return False
        if not lv.get("default_sort"):
            return False

        # Check badge_colors on enum fields
        for f in entity.get("fields", []):
            if f.get("enum_values") and not f.get("badge_colors"):
                return False

    # Dashboard cards
    dashboard = spec.get("dashboard", {})
    if len(dashboard.get("stat_cards", [])) < 1:
        return False

    return True


def main():
    print("=" * 70)
    print("SPEC ENRICHMENT TOOL — Remaining specs (idempotent)")
    print("=" * 70)

    # 1. Scan all spec files
    print("\n[1/4] Scanning all spec files...")
    all_specs = []
    for fname in sorted(os.listdir(SPEC_DIR)):
        if not fname.endswith("_spec.json"):
            continue
        fpath = os.path.join(SPEC_DIR, fname)
        try:
            with open(fpath) as f:
                spec = json.load(f)
            all_specs.append((fname, fpath, spec))
        except Exception as e:
            print(f"  WARNING: Could not read {fname}: {e}")

    total_specs = len(all_specs)
    print(f"  Found {total_specs} spec files")

    # 2. Filter to those that still need enrichment
    print("\n[2/4] Checking enrichment status...")
    already_done = 0
    needs_enrichment = []
    for fname, fpath, spec in all_specs:
        if is_already_enriched(spec):
            already_done += 1
        else:
            needs_enrichment.append((fname, fpath, spec))

    print(f"  Already enriched: {already_done}")
    print(f"  Needs enrichment: {len(needs_enrichment)}")

    if not needs_enrichment:
        print("\n  All specs are already enriched! Nothing to do.")
        return

    # 3. Enrich each spec
    print(f"\n[3/4] Enriching {len(needs_enrichment)} specs...")
    stats = defaultdict(int)
    enriched_files = []

    for i, (fname, fpath, spec) in enumerate(needs_enrichment):
        original_score = score_spec(spec)
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

        if (i + 1) % 50 == 0 or i < 5 or (i + 1) == len(needs_enrichment):
            print(f"  [{i+1:4d}/{len(needs_enrichment)}] {fname:45s} "
                  f"score {original_score:3d} -> {new_score:3d}  ({change_str})")

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
    print("ENRICHMENT SUMMARY — Remaining specs")
    print("=" * 70)
    print(f"  Total specs scanned:      {total_specs}")
    print(f"  Already enriched (skip):  {already_done}")
    print(f"  Specs enriched now:       {written}")
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

    if len(enriched_files) > 20:
        print(f"  ... and {len(enriched_files) - 20} more")

    # Score distribution after enrichment
    print("\nSCORE DISTRIBUTION (after enrichment):")
    scores = [score_spec(spec) for _, _, spec in all_specs]
    scores.sort()
    print(f"  Min:    {scores[0]}")
    print(f"  25th:   {scores[len(scores)//4]}")
    print(f"  Median: {scores[len(scores)//2]}")
    print(f"  75th:   {scores[3*len(scores)//4]}")
    print(f"  Max:    {scores[-1]}")

    print("\nDone!")


if __name__ == "__main__":
    main()
