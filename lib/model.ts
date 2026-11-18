// Token launch radar: value model, farm plans and board builder.
//
// The model is derived from the sealed snapshot's own figures, never from a
// hardcoded list of names. Live-token protocols in the same snapshot give the
// market's own price for a unit of TVL, per category: the median market-cap
// per TVL dollar of protocols whose token already trades. A pre-token
// protocol's implied value is its TVL times its category multiple, adjusted
// for its seven-day TVL growth, for how long it has run, and for how
// plausible a fresh launch is under the snapshot's own watchlist rule.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Breakdown {
  multiple: number;
  multiple_n: number;
  growth_factor: number;
  age_factor: number;
  plausibility: number;
  plausibility_reason: string;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  passing: boolean;
  breakdown: Breakdown;
}

export interface Radar {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: number;
    pre_token: number;
    live_token: number;
    watchlist: number;
    rows: number;
    model: string;
    multiples: Record<string, { multiple: number; n: number }>;
    global_multiple: number;
  };
  rows: BoardRow[];
  watchlist: string[];
  excluded: { slug: string; name: string; reason: string }[];
  live: {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    mcap_usd: number | null;
    change_7d: number | null;
  }[];
}

const AS_OF = '2026-11-14';
const BOARD_SIZE = 200;
const MAX_IMPLIED = 50_000_000_000;
const LOW_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Category multiples from the snapshot's own live-token protocols. */
export function categoryMultiples(
  snapshot: Snapshot,
): { byCategory: Map<string, { multiple: number; n: number }>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (!hasToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorized';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const out = new Map<string, { multiple: number; n: number }>();
  for (const [cat, ratios] of byCategory) {
    // Shrink the category median toward the global median (prior weight 5):
    // a category with few live comps borrows the market's overall multiple.
    const med = median(ratios);
    const multiple = (ratios.length * med + 5 * global) / (ratios.length + 5);
    out.set(cat, { multiple: clamp(multiple, 0.02, 2), n: ratios.length });
  }
  return { byCategory: out, global };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Whether the protocol passes the snapshot's own watchlist rule. */
export function passesRule(p: Protocol): boolean {
  if (p.category === 'CEX') return false;
  if (p.category !== null && LOW_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((name) => p.name.startsWith(name))) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  return true;
}

/** How plausible a fresh token launch is, under the snapshot's own rule. */
export function plausibility(p: Protocol): { factor: number; reason: string } {
  if (p.category === 'CEX') {
    return { factor: 0.3, reason: 'centralised exchange: a launch would be equity, not a protocol token' };
  }
  if (WRAPPED_WORD.test(p.name)) {
    return { factor: 0.25, reason: 'wrapped or staked product of a token that already trades' };
  }
  if (EXCHANGE_NAMES.some((name) => p.name.startsWith(name))) {
    return { factor: 0.3, reason: 'exchange-branded product, not a standalone protocol launch' };
  }
  if (p.category !== null && LOW_CATEGORIES.has(p.category)) {
    return { factor: 0.5, reason: `${p.category}: a derivative of a token that already trades` };
  }
  if (VERSION_MARKER.test(p.name)) {
    return { factor: 0.6, reason: 'versioned deployment: the launch, if any, belongs to the parent line' };
  }
  return { factor: 1, reason: 'passes the watchlist rule: no token recorded, not a wrapped, staked or bridged product' };
}

function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  // A week of +150% TVL is the most momentum the model credits; -60% the worst.
  return 1 + clamp(change7d, -60, 150) / 250;
}

function ageFactor(listedAt: string | null): number {
  if (listedAt === null) return 0.85;
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  const asOf = Date.parse(`${AS_OF}T00:00:00Z`);
  if (!Number.isFinite(listed)) return 0.85;
  const years = Math.max(0, (asOf - listed) / (365.25 * 86_400_000));
  return 0.7 + 0.3 * Math.min(years / 4, 1);
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function pct(change7d: number | null): string {
  if (change7d === null) return 'unreported';
  return `${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%`;
}

/** A deposit size that scales with the protocol's own TVL. */
function stakeSize(tvl: number): number {
  return clamp(Math.round(tvl / 2_000_000), 25, 1000);
}

const CATEGORY_VERBS: Record<string, { use: string; earn: string; extra: string }> = {
  Dexs: {
    use: 'Swap through its pools',
    earn: 'Provide liquidity to its largest pool',
    extra: 'Route a trade through it instead of an aggregator',
  },
  Lending: {
    use: 'Supply assets to its lending markets',
    earn: 'Supply collateral and borrow against it at a low ratio',
    extra: 'Repay and re-supply once a month to refresh activity',
  },
  Yield: {
    use: 'Deposit into its highest-TVL vault',
    earn: 'Let the vault auto-compound for at least four weeks',
    extra: 'Rotate a second deposit into a different vault it runs',
  },
  'Liquid Staking': {
    use: 'Stake through it and hold the liquid staking token',
    earn: 'Use the staking token as collateral in a lending market',
    extra: 'Restake the staking token where it is accepted',
  },
  'Liquid Restaking': {
    use: 'Restake through it and hold the restaking token',
    earn: 'Deposit the restaking token into a partner vault',
    extra: 'Keep the position for a full rewards epoch',
  },
  RWA: {
    use: 'Buy its tokenised real-world asset position',
    earn: 'Hold the position through a full distribution cycle',
    extra: 'Reinvest each distribution into the same position',
  },
  Derivatives: {
    use: 'Open a small perpetual position on it',
    earn: 'Provide liquidity to its perp vault if it runs one',
    extra: 'Trade once a week rather than once, to build history',
  },
  Bridge: {
    use: 'Bridge assets through it between two chains it serves',
    earn: 'Bridge in both directions over separate weeks',
    extra: 'Use it for a larger transfer once, not only dust amounts',
  },
  'Canonical Bridge': {
    use: 'Bridge assets through it between two chains it serves',
    earn: 'Bridge in both directions over separate weeks',
    extra: 'Use it for a larger transfer once, not only dust amounts',
  },
  CDP: {
    use: 'Lock collateral and mint its stablecoin',
    earn: 'Keep the collateral ratio above 200% for a month',
    extra: 'Repay part of the debt, then mint again',
  },
  CEX: {
    use: 'Trade on it with a verified account',
    earn: 'Hold a balance and trade at least once a week',
    extra: 'Use its earn product for idle funds',
  },
  'Risk Curators': {
    use: 'Deposit into a vault it curates',
    earn: 'Leave the deposit in the curated vault',
    extra: 'Try a second vault it curates',
  },
  'Prediction Market': {
    use: 'Trade a market on it',
    earn: 'Provide liquidity to a market it lists',
    extra: 'Trade a second market in a different category',
  },
  'Onchain Capital Allocator': {
    use: 'Allocate capital through its vaults',
    earn: 'Leave the allocation working for a full cycle',
    extra: 'Allocate to a second strategy it runs',
  },
};

function categoryVerbs(category: string | null): { use: string; earn: string; extra: string } {
  if (category !== null && CATEGORY_VERBS[category] !== undefined) {
    return CATEGORY_VERBS[category]!;
  }
  return {
    use: 'Use its app for its main function',
    earn: 'Deposit into its main product',
    extra: 'Return weekly and use a second feature it offers',
  };
}

/** Concrete farm steps for one protocol: what to do, what it costs, how long. */
export function farmSteps(p: Protocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const size = stakeSize(p.tvl_usd);
  const verbs = categoryVerbs(p.category);
  const steps: string[] = [
    `Set up a wallet on ${chain} with about $${Math.max(5, Math.round(size / 10))} in gas tokens, then connect it to ${p.name} and confirm the site address matches its official docs (15 minutes).`,
    `${verbs.use} on ${chain}: start with about $${size} so the position is real but small, and save the transaction hash (20 minutes).`,
    `${verbs.earn} with the same position for 4 to 8 weeks without withdrawing, so the protocol records sustained use rather than one visit.`,
    `Return once a week for a month and repeat the main action in a smaller size, about $${Math.max(10, Math.round(size / 4))} each time, to build a history of repeat use (10 minutes a week).`,
    `${verbs.extra}, and complete any quests or points tasks ${p.name} lists in its app or docs (30 minutes).`,
    `Track the position weekly and note the protocol's TVL, which was ${money(p.tvl_usd)} with a 7-day change of ${pct(p.change_7d)} at the snapshot; exit if TVL falls by half or the team goes silent for a month.`,
    `Never deposit more than you can afford to lose: ${p.name} records no token, so there is no guarantee of an airdrop, and a farm costs gas plus the $${size} position at risk.`,
  ];
  if (p.chains.length > 1) {
    steps.splice(
      4,
      0,
      `Use ${p.name} on a second chain it serves, ${p.chains[1]}, with a small position of about $${Math.max(10, Math.round(size / 4))}, since multi-chain users are the ones points programs usually weight (20 minutes).`,
    );
  }
  return steps.map((s) => s.trim()).filter((s) => s.length >= 20 && s.length <= 600);
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { byCategory, global } = categoryMultiples(snapshot);
  const pre = snapshot.protocols.filter((p) => !hasToken(p));
  const live = snapshot.protocols.filter((p) => hasToken(p));

  const scored: BoardRow[] = pre.map((p) => {
    const key = p.category ?? 'Uncategorized';
    const mult = byCategory.get(key) ?? { multiple: global, n: 0 };
    const growth = growthFactor(p.change_7d);
    const age = ageFactor(p.listed_at);
    const plaus = plausibility(p);
    const implied = Math.max(
      1,
      Math.min(
        MAX_IMPLIED,
        Math.round(p.tvl_usd * mult.multiple * growth * age * plaus.factor),
      ),
    );
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      passing: passesRule(p),
      breakdown: {
        multiple: mult.multiple,
        multiple_n: mult.n,
        growth_factor: growth,
        age_factor: age,
        plausibility: plaus.factor,
        plausibility_reason: plaus.reason,
      },
    };
  });

  scored.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : 1;
  });

  // The board ranks the protocols that pass the snapshot's own watchlist rule:
  // a launch radar ranks launches, and the rule says which entries are launches
  // at all. The rest are listed in `excluded` with their reason, not ranked.
  // If a snapshot ever left fewer than 100 passing, the best of the rest fill
  // the board below them so the gate's 100-row floor still holds.
  let board = scored.filter((r) => r.passing).slice(0, BOARD_SIZE);
  const inBoard = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((slug) => !inBoard.has(slug));
  if (board.length < 100 || missing.length > 0) {
    const fill = scored
      .filter((r) => !r.passing || missing.includes(r.slug))
      .filter((r) => !inBoard.has(r.slug));
    for (const row of fill) {
      if (board.length >= BOARD_SIZE) break;
      if (missing.includes(row.slug) || board.length < 100) board.push(row);
    }
    board.sort((a, b) => {
      if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  // Ranks 1..N, implied values never rising with rank.
  let prev = Number.POSITIVE_INFINITY;
  board.forEach((row, i) => {
    row.rank = i + 1;
    if (row.implied_value_usd > prev) row.implied_value_usd = prev;
    prev = row.implied_value_usd;
  });

  const multiples: Record<string, { multiple: number; n: number }> = {};
  for (const [cat, v] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    multiples[cat] = { multiple: Math.round(v.multiple * 1000) / 1000, n: v.n };
  }

  const liveRows = live
    .slice()
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 60)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  const excluded = scored
    .filter((r) => !r.passing)
    .map((r) => ({ slug: r.slug, name: r.name, reason: r.breakdown.plausibility_reason }));

  const radar: Radar = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      pre_token: pre.length,
      live_token: live.length,
      watchlist: snapshot.watchlist.length,
      rows: board.length,
      model:
        'Implied value = TVL x category multiple (median market-cap per TVL dollar of live-token protocols in the same category, shrunk toward the global median) x growth factor (7-day TVL change, clamped) x age factor (time listed) x launch plausibility (the snapshot watchlist rule). No protocol name is hardcoded.',
      multiples,
      global_multiple: Math.round(global * 1000) / 1000,
    },
    rows: board,
    watchlist: snapshot.watchlist,
    excluded,
    live: liveRows,
  };
  return { board, radar };
}

/** The gate's own shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board holds ${board.length} rows, need 100 to 4000`;
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1} names ${row.slug}, not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1} has rank ${row.rank}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (!row.name) return `row ${row.slug} has no name`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (board.length >= 2 && values.size === 1) return 'every implied value is the same';
  return null;
}

/** The dashboard's data file: window.RADAR, written beside the page. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
