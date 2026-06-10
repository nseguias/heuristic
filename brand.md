# HEURISTIC — Brand & Design Direction

Bitcoin chain-forensics explorer. UTXO flow graphs, clustering, coinjoin detection, taint scoring.

## Direction

**Forensics workstation**: Workstation Dense × industrial/utilitarian. Dark-native, mono-heavy,
information-dense but organized. The graph canvas is the hero; chrome recedes. Feels like lab
equipment, not a marketing site. Original — not a mempool.space or Chainalysis clone.

## Palette (Tier 1 tokens)

Warm graphite base + phosphor amber signature accent. All other color is semantic, never decorative.

- `--bg`            #0B0A08  (near-black, warm)
- `--surface`       #12110E  (panel)
- `--surface-2`     #181610  (raised panel / hover)
- `--line`          rgba(231, 222, 202, 0.08)  (hairline borders)
- `--line-strong`   rgba(231, 222, 202, 0.16)
- `--text`          #E7DECA  (warm off-white)
- `--text-dim`      #8A8472  (secondary)
- `--text-faint`    #55503F  (micro-labels, disabled)
- `--accent`        #F5A623  (phosphor amber — selection, active, brand moments)
- `--accent-dim`    rgba(245, 166, 35, 0.14)

Semantic (data only):
- `--clean`   #7FB069  (sage green — low risk)
- `--warn`    #E0A458  (amber — medium risk / unknown)
- `--taint`   #E4572E  (signal red — high risk / flagged ancestry)
- `--mix`     #4ECDC4  (cyan — coinjoin / mixing events)

Risk is a continuous spectrum clean → warn → taint. Coinjoin cyan is categorical, outside the spectrum.

**Money colour convention (site-wide):** BTC / sats amounts render in `--accent`
(orange); USD / fiat amounts render in `--clean` (green). Always pair a unit
("BTC", "$", "sat/vB") with the number so it's never ambiguous. Fee *rates* are
sat-denominated → orange, always suffixed `sat/vB`.

## Typography

- Display / UI labels: **Space Grotesk** (next/font), tight tracking on display (-0.03em)
- Data / numbers / hashes / body: **IBM Plex Mono**, `tabular-nums` always
- Micro-labels: 10–11px uppercase Plex Mono, letter-spacing 0.12em, `--text-faint`
- Scale: 11 / 13 / 14 / 18 / 28 / 44. Weights: 400, 500, 700 only.

## Layout

- Explorer: full-bleed canvas, floating panels (left rail = controls, right = inspector), asymmetric
- Landing: asymmetric, left-weighted. No centered hero, no 3-col feature grid.
- Density: compact — 4/8/12px padding. Panel separation by hairline border + bg shade, never shadow.
- Radius: 2px on panels/inputs (near-square, instrument-like), 0 on table rows, full on status dots.

## Texture & canvas

- Dot-grid background texture on canvas (very faint), subtle vignette
- Edge glow on graph edges (canvas shadowBlur in accent/semantic colors)
- Scanline sweep on landing only, slow (ambient, not looping spectacle)

## Motion

- Functional: 150ms data updates, 200ms panel slides, custom cubic-bezier(0.2, 0, 0, 1)
- Entry 300ms / exit 180ms (asymmetric)
- Ambient drift allowed only inside the graph simulation
- No bounce, no decorative loops in chrome

## Voice

Terse, technical, instrument-like. "TRACE", "ANCESTRY DEPTH 4", "CLUSTER 0x3F". No marketing
hedging, no "powerful insights". Empty states read like idle equipment: "AWAITING TARGET".
