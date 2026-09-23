import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  availableCategories,
  categoryCounts,
  categoryLabel,
  filterProviders,
  groupProviders,
  highlightAfterListChange,
  indexOfProvider,
  matchesQuery,
  moveHighlight,
} from './provider-filter.ts';
import { PROVIDERS, PROVIDER_CATEGORIES, type ProviderConfig } from './ai-providers.ts';

function provider(partial: Partial<ProviderConfig> & { id: string }): ProviderConfig {
  return {
    label: partial.id,
    apiFormat: 'openai',
    defaultModel: 'm',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    ...partial,
  } as ProviderConfig;
}

const CATALOG: ProviderConfig[] = [
  provider({ id: 'deepseek', label: 'DeepSeek', category: 'cn', badge: '热门推荐' }),
  provider({ id: 'openai', label: 'OpenAI', category: 'global', description: 'GPT-5 旗舰' }),
  provider({ id: 'anthropic', label: 'Anthropic Claude', category: 'global' }),
  provider({ id: 'ollama', label: 'Ollama', category: 'local' }),
  provider({ id: 'openai-compat', label: 'OpenAI Compatible', category: 'local' }),
];

test('matchesQuery is case-insensitive across label, id, description and badge', () => {
  const p = CATALOG[0];
  assert.equal(matchesQuery(p, ''), true);
  assert.equal(matchesQuery(p, '   '), true);
  assert.equal(matchesQuery(p, 'deep'), true);
  assert.equal(matchesQuery(p, 'DEEPSEEK'), true);
  assert.equal(matchesQuery(p, '热门'), true);
  assert.equal(matchesQuery(p, 'nope'), false);
  assert.equal(matchesQuery(CATALOG[1], 'gpt-5'), true, 'description is searched');
});

test('filterProviders applies the category and the search term together', () => {
  assert.equal(filterProviders(CATALOG, '', 'all').length, 5);
  assert.deepEqual(
    filterProviders(CATALOG, '', 'global').map((p) => p.id),
    ['openai', 'anthropic'],
  );
  // Search must not escape the selected category.
  assert.deepEqual(
    filterProviders(CATALOG, 'openai', 'global').map((p) => p.id),
    ['openai'],
  );
  // …but it does match inside the category it is scoped to.
  assert.deepEqual(
    filterProviders(CATALOG, 'openai', 'local').map((p) => p.id),
    ['openai-compat'],
  );
  assert.deepEqual(filterProviders(CATALOG, 'zzz', 'all'), []);
});

test('groupProviders keeps catalog order and never emits an empty group', () => {
  const groups = groupProviders(filterProviders(CATALOG, '', 'all'), 'all');
  assert.deepEqual(
    groups.map((g) => g.category?.id),
    ['cn', 'global', 'local'],
  );
  assert.deepEqual(
    groups.map((g) => g.items.length),
    [1, 2, 2],
  );

  // A category filter collapses to one group.
  const scoped = groupProviders(filterProviders(CATALOG, '', 'local'), 'local');
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].category?.id, 'local');

  // Empty categories are dropped rather than rendered as a bare header.
  const onlyCn = groupProviders(filterProviders(CATALOG, 'deepseek', 'all'), 'all');
  assert.deepEqual(
    onlyCn.map((g) => g.category?.id),
    ['cn'],
  );
});

test('groupProviders collects uncategorised providers into a trailing group', () => {
  const withExtra = [...CATALOG, provider({ id: 'mystery', label: 'Mystery' })];
  const groups = groupProviders(withExtra, 'all');
  const last = groups[groups.length - 1];
  assert.equal(last.category, undefined, 'uncategorised entries go last');
  assert.deepEqual(
    last.items.map((p) => p.id),
    ['mystery'],
  );
});

test('highlightAfterListChange resets to the first item, or nothing when empty', () => {
  // Regression: the index used to survive a search change, so Enter selected
  // an unrelated provider — or nothing at all once the index ran past the end.
  assert.equal(highlightAfterListChange(3), 0);
  assert.equal(highlightAfterListChange(1), 0);
  assert.equal(highlightAfterListChange(0), -1);
});

test('moveHighlight wraps in both directions and handles an empty highlight', () => {
  assert.equal(moveHighlight(0, 1, 3), 1);
  assert.equal(moveHighlight(2, 1, 3), 0, 'down wraps to the top');
  assert.equal(moveHighlight(0, -1, 3), 2, 'up wraps to the bottom');

  // Nothing highlighted yet: down picks the first, up picks the last. The
  // naive formula landed one short on the "up" case.
  assert.equal(moveHighlight(-1, 1, 3), 0);
  assert.equal(moveHighlight(-1, -1, 3), 2);

  assert.equal(moveHighlight(0, 1, 0), -1);
  assert.equal(moveHighlight(-1, -1, 0), -1);
});

test('indexOfProvider finds the selected provider or reports -1', () => {
  assert.equal(indexOfProvider(CATALOG, 'anthropic'), 2);
  assert.equal(indexOfProvider(CATALOG, 'not-here'), -1);
});

test('availableCategories only offers tabs that have providers', () => {
  const ids = availableCategories(CATALOG).map((c) => c.id);
  assert.deepEqual(ids, ['cn', 'global', 'local']);
  // The real catalog covers all four categories, so nothing is hidden there.
  assert.deepEqual(
    availableCategories(PROVIDERS).map((c) => c.id),
    PROVIDER_CATEGORIES.map((c) => c.id),
  );
});

test('categoryCounts includes the all bucket and matches the catalog', () => {
  const counts = categoryCounts(PROVIDERS);
  assert.equal(counts.all, PROVIDERS.length);
  const summed = PROVIDER_CATEGORIES.reduce((n, c) => n + counts[c.id], 0);
  assert.equal(summed, PROVIDERS.length, 'every provider belongs to a category');
});

test('categoryLabel follows the UI language instead of always showing Chinese', () => {
  const cat = { name: '国内主流大模型', nameEn: 'China AI Models' };
  assert.equal(categoryLabel(cat, 'zh'), '国内主流大模型');
  assert.equal(categoryLabel(cat, 'zh-CN'), '国内主流大模型');
  assert.equal(categoryLabel(cat, 'en'), 'China AI Models');
  assert.equal(categoryLabel(cat, 'de'), 'China AI Models');
});
