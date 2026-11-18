# Token Launch Radar

Ranks pre-token protocols by implied fully-diluted valuation, so you can see
which launches the market would price highest — before any token exists.

Built for the make.fun bounty **token-radar-01** and submitted 2026-11-18
(entry `01a1ef4a-33c5-7440-b55f-c672489676a1`). Snapshot: 758 protocols
(342 pre-token, 416 live-token), as of 2026-11-14, DefiLlama.

## The model

Implied value = TVL × category multiple × growth factor × age factor ×
launch plausibility.

- **Category multiple** — the median market-cap per TVL dollar of live-token
  protocols in the same category, shrunk toward the global median (0.214)
  when a category has few live comps, clamped to [0.02, 2.0].
- **Growth factor** — `1 + clamp(change_7d, -60, 150) / 250`; 1.0 when unknown.
- **Age factor** — `0.7 + 0.3 × min(years / 4, 1)`; 0.85 when unknown.
- **Launch plausibility** — the snapshot's own watchlist rule: 1.00× when it
  passes, 0.60× for a versioned deployment, 0.50× for a bridge or
  liquid-staking product, 0.30× for a centralised exchange, 0.25× for a
  wrapped or staked product of a token that already trades.

The board lists the 198 pre-token protocols that pass the watchlist rule
(watchlist 40/40); the other 144 pre-token protocols are in
`out/board.json` under `radar.excluded`, with reasons. Top of the board:
Steakhouse Financial (~$1.49B implied on $2.75B TVL), Sentora Curator,
Gauntlet, Polymarket International. Every row also gets a 7–8 step farm plan.

## Run it

Node 22, standard library only — no dependencies, no network.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Reads the sealed snapshot, writes `board.json`, `data.js`, a copy of
`dashboard/`, and `dossier.json` to the output directory. Two runs produce
byte-identical output: no clock, no randomness, every order fixed.

## View the board

Open `out/dashboard/index.html` in a browser (it reads `out/data.js`, so keep
them together). Search, filter by category or chain, sort, toggle watchlist
only, and open any protocol for its model breakdown and farm plan.

## Layout

- `main.ts` — entry point, reads the snapshot, writes the outputs.
- `lib/model.ts` — the scoring model, board builder, farm plans.
- `vendor/makefun-board.ts` — the make.fun kit library, vendored verbatim.
- `dashboard/` — the board UI (static HTML/CSS/JS, no network).
- `out/` — output of the submitted run: `board.json`, `data.js`,
  `dossier.json`, and a copy of the dashboard.
- `.makefun/freshness.json` — the drand anchor for the submission snapshot.

The three dashboard screenshots from the submission are PNG captures and live
in the make.fun entry bundle, not in this repo.
