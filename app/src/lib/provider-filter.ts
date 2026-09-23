/**
 * Pure selection and navigation logic for `ProviderSelect.vue`.
 *
 * Split out of the component so it is unit-testable: this repo's test runner
 * only covers `src/lib/*.test.ts` and there is no component-test harness set up
 * (no vitest / @vue/test-utils). What lives here is exactly the part that had
 * bugs — a highlight index that survived a search change, wrap-around that
 * misbehaved when nothing was highlighted yet, and category state that leaked
 * between openings.
 */

import { PROVIDER_CATEGORIES, type ProviderCategory, type ProviderConfig } from './ai-providers';

export type CategoryFilter = 'all' | ProviderCategory;

/** Case-insensitive match over label / id / description / badge. */
export function matchesQuery(p: ProviderConfig, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    p.label.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.description?.toLowerCase().includes(q) ?? false) ||
    (p.badge?.toLowerCase().includes(q) ?? false)
  );
}

/** Providers visible for a given search term and category tab. */
export function filterProviders(
  providers: ProviderConfig[],
  query: string,
  category: CategoryFilter,
): ProviderConfig[] {
  return providers.filter(
    (p) => (category === 'all' || p.category === category) && matchesQuery(p, query),
  );
}

export interface ProviderGroup {
  category: (typeof PROVIDER_CATEGORIES)[number] | undefined;
  items: ProviderConfig[];
}

/** The display groups: one per category when showing "all", else a single group. */
export function groupProviders(
  filtered: ProviderConfig[],
  category: CategoryFilter,
): ProviderGroup[] {
  if (category !== 'all') {
    const cat = PROVIDER_CATEGORIES.find((c) => c.id === category);
    return [{ category: cat, items: filtered }];
  }
  const groups: ProviderGroup[] = [];
  for (const cat of PROVIDER_CATEGORIES) {
    const items = filtered.filter((p) => p.category === cat.id);
    if (items.length > 0) groups.push({ category: cat, items });
  }
  const uncategorized = filtered.filter((p) => !p.category);
  if (uncategorized.length > 0) groups.push({ category: undefined, items: uncategorized });
  return groups;
}

/**
 * Where the highlight should land after the visible list changes.
 *
 * Always reset to the first item. `highlightedIndex` is a *position* into the
 * filtered list, so once the user types a search term the old index points at
 * an unrelated provider — or past the end, where the `index < length` guard
 * silently swallowed Enter and nothing got selected.
 */
export function highlightAfterListChange(length: number): number {
  return length > 0 ? 0 : -1;
}

/**
 * Wrap-around movement for ArrowDown (`delta = 1`) / ArrowUp (`delta = -1`).
 *
 * Starting from "nothing highlighted" (-1) means the first ArrowDown selects
 * the first item and the first ArrowUp selects the last one; the naive
 * `(current + delta + length) % length` lands one short in that case.
 */
export function moveHighlight(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (base + delta + length) % length;
}

/** Index of the selected provider in the visible list, or -1. */
export function indexOfProvider(providers: ProviderConfig[], id: string): number {
  return providers.findIndex((p) => p.id === id);
}

/**
 * Category tabs that have at least one provider, so an empty tab is never
 * offered.
 */
export function availableCategories(
  providers: ProviderConfig[],
): typeof PROVIDER_CATEGORIES {
  return PROVIDER_CATEGORIES.filter(
    (cat) => providers.filter((p) => p.category === cat.id).length > 0,
  );
}

/** Per-category provider counts, including the `all` bucket. */
export function categoryCounts(providers: ProviderConfig[]): Record<string, number> {
  const counts: Record<string, number> = { all: providers.length };
  for (const cat of PROVIDER_CATEGORIES) {
    counts[cat.id] = providers.filter((p) => p.category === cat.id).length;
  }
  return counts;
}

/**
 * Category label for the active UI language. The catalog carries both a
 * Chinese and an English name; showing the Chinese one to a German user was
 * the reason these used to read as untranslated.
 */
export function categoryLabel(
  cat: { name: string; nameEn: string },
  lang: string,
): string {
  return lang.toLowerCase().startsWith('zh') ? cat.name : cat.nameEn;
}
