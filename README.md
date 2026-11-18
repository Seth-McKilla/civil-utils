# civil-utils

Small Node.js command-line utilities for civil / coastal engineering tasks.

## Setup

Requires [Node.js](https://nodejs.org/) (v18+) and [pnpm](https://pnpm.io/).

```bash
pnpm install
```

Every utility can be run with `pnpm <script>` or `node <folder>`. Generated files go to each utility's `output/` (or `files/`) folder. `input/`, `output/` and `files/` folders are git-ignored.

| Utility | Script | What it does |
|---|---|---|
| [avg-wind-speeds](#avg-wind-speeds) | `pnpm wind` | Design sustained wind speeds by direction from NOAA NDBC historical data |
| [wave-heights](#wave-heights) | `pnpm waves` | Projected wave heights on restricted fetches (Smith 1991) + wave rose PDF |
| [adjacent-properties](#adjacent-properties) | `pnpm props` | Owner names and mailing addresses from MD SDAT property pages |
| [kml2mdspnad83ftcsv](#kml2mdspnad83ftcsv) | `pnpm kml2csv` | KML points → MD State Plane NAD83 (US ft) CSV |
| [txt-update](#txt-update) | `pnpm txtupdate` | Filter a point file by description and renumber points |

---

## avg-wind-speeds

Downloads NOAA NDBC historical standard meteorological data for a station and computes design sustained wind speeds by direction. It uses `WSPD`, the NDBC sustained average: 8 minutes on buoys, 2 minutes on C-MAN stations. Gusts (`GST`) are not used, because wave growth is driven by sustained wind over the fetch.

```bash
pnpm wind <station> <startYear> <endYear> <direction|all> [range=15] [mode=rp]
```

| Argument | Description |
|---|---|
| `station` | NDBC station ID, e.g. `44062`, `ocim2` |
| `startYear` / `endYear` | Range of years to download |
| `direction` | Wind direction in degrees, or `all` for every 5° (0–355°) |
| `range` | ± degrees around each direction to include (default 15) |
| `mode` | `rp` (default): return-period winds. Otherwise a number X to average the top X% of wind speeds, or `max` for the single highest. |

**Return-period mode (`rp`, recommended for design):**
1. WSPD records are averaged into hourly winds. This gives roughly a 1-hour sustained wind, which matches the SPM/Smith growth equations and filters out minutes-long thunderstorm spikes.
2. The annual maximum hourly wind is taken for each year and direction.
3. A Gumbel distribution (method of moments) is fit to the annual maxima, giving **10-, 25-, 50- and 100-year** winds.
4. Years with less than 50% of the median year's record count (partial deployments or outages) are skipped and listed in the console.
5. With about 15 years of data, 50- and 100-year values are extrapolations; treat them as estimates.

Examples:

```bash
pnpm wind 44062 2010 2025 all 15       # 10/25/50/100-yr winds for every 5° direction (default rp mode)
pnpm wind 44062 2010 2025 all 15 1     # top 1% avg sustained wind for every 5° direction
pnpm wind ocim2 2008 2025 40 15 1      # single direction, 40° ± 15°
pnpm wind 44062 2010 2025 all 15 max   # max sustained wind for every 5° direction
```

Output: `avg-wind-speeds/output/<station>_<start>-<end>_<dir<deg>|all-dirs>_range<range>_<rp|top<X>pct|max>.csv` (speeds in m/s).
- `rp` columns: `direction_deg, years, mean_annual_max_ms, std_annual_max_ms, rp10_wspd_ms, rp25_wspd_ms, rp50_wspd_ms, rp100_wspd_ms`
- Percentile and max columns: `direction_deg, total_records, top_n_records, avg_wspd_ms`

Find stations at <https://www.ndbc.noaa.gov/>.

---

## wave-heights

Computes projected significant wave height (Hmo, ft) and peak period for each wind direction using the USACE restricted-fetch method in Smith (1991), *Wind-Wave Generation on Restricted Fetches*, CERC Misc. Paper CERC-91-2. It also makes a PDF with a wave rose and a fetch rose.

### Steps

1. Run `avg-wind-speeds` with `all` directions (see above).
2. Put the fetch lengths file in `wave-heights/input/`. This can be `.xlsx`, `.xls` or `.csv` with columns `Layer, Length`, where Layer is the direction (`_005`, `_010`, … `_360`) and Length is the fetch (feet by default).
3. Run:

   ```bash
   pnpm waves
   ```

   By default it uses the newest fetch file in `wave-heights/input/` and the newest CSV in `avg-wind-speeds/output/`.

### Options

```bash
node wave-heights [fetchFile] [windCsv] [--units ft] [--z 10] [--rt 1.1]
```

| Option | Default | Description |
|---|---|---|
| `fetchFile` | newest in `input/` | Path to a specific fetch lengths file |
| `windCsv` | newest in `avg-wind-speeds/output/` | Path to a specific wind CSV |
| `--units` | `ft` | Fetch length units: `ft`, `m`, `mi`, `km`, `nmi` |
| `--z` | `10` | Anemometer height (m). The wind is adjusted to 10 m by (10/z)^(1/7). Use the station's anemometer height from its NDBC page (e.g. 44062 = 3 m). |
| `--rt` | `1.1` | Air–sea stability factor R_T (1.1 = unstable/unknown, per SPM) |
| `--rp` | `25` | Return period (yr) to use from an `rp` wind CSV: 10, 25, 50 or 100 |
| `--depth` | none (deep water) | Average water depth along the fetch at the design water level (ft). Applies SPM 1984 shallow-water growth. |

Examples:

```bash
pnpm waves --z 3                 # 25-yr wind, deep water, 44062 anemometer at 3 m
pnpm waves --z 3 --depth 12      # 25-yr wind, 12 ft average fetch depth
pnpm waves --z 3 --rp 50         # 50-yr wind
```

Output files are tagged with the return period and depth, e.g. `waves_<wind file>25_d12ft.pdf`.

### Output

Written to `wave-heights/output/`:

- `waves_<wind file name>.csv`: wind direction, wind speed U, wind stress factor U_A, wave direction, φ, effective fetch (ft), Hmo (ft), Tp (s), condition
- `waves_<wind file name>.pdf`:
  - Page 1: the Hmo wave rose, with the dominant direction in each quadrant highlighted, next to the measured fetch rose. The wind statistic used (station, years, percentile) is in the header.
  - Page 2: the full results table.

### Method (Smith 1991)

1. Radial fetches are interpolated to 1° and averaged over 15° arcs.
2. Wind speed is adjusted to 10 m and for stability, then converted to the wind stress factor U_A = 0.71·U^1.23.
3. The wave direction is the angle φ within ±90° of the wind that maximizes F^0.28·cos(φ)^0.44 (Eq. 11).
4. Wave height and period (Eq. 9): Hmo = 0.0015·(U_A cos φ)·√(F/g), and Tp = 1/fp with fp = 2.6·g^0.72·F^−0.28·(U_A cos φ)^−0.44.
5. Results are capped at the SPM fully developed limit.
6. With `--depth`, the Eq. 11 fetch and U_A cos φ are applied to the SPM (1984) shallow-water equations (3-39, 3-40), as Smith 1991 recommends for shallow water. The lower of the deep- and shallow-water heights is reported, labeled `depth-limited`.

Limitations:
- Duration limits are not checked.
- `rp` winds are hourly averages, so they match the method. Percentile and max winds are raw 8-min or 2-min averages, which is slightly conservative.
- Depth-induced breaking at the site is not applied. Check H ≤ ~0.78 × the local depth at the structure.

---

## adjacent-properties

Scrapes owner name(s) and mailing address from Maryland SDAT Real Property detail pages.

1. Edit the `urlObjects` array in `adjacent-properties/index.js` with the SDAT `viewdetails.aspx` URLs for the properties.
2. Run:

   ```bash
   pnpm props
   ```

Output: `adjacent-properties/output/adjacent-properties.txt`

---

## kml2mdspnad83ftcsv

Converts KML placemark points (WGS84) to Maryland State Plane NAD83, US survey feet (EPSG:2248).

1. Save the KML as `kml2mdspnad83ftcsv/files/input.kml`. Placemarks must be inside a Folder.
2. Run:

   ```bash
   pnpm kml2csv
   ```

Output: `kml2mdspnad83ftcsv/files/output.csv` with columns `Point, Northing, Easting, Elevation, Description`.

---

## txt-update

Filters a comma-delimited point file (`Point,Northing,Easting,Elevation,Description`) to the points with a given description, then renumbers them starting at 1.

1. Save the point file as `txt-update/files/input.txt`.
2. Run:

   ```bash
   pnpm txtupdate "<description>"
   ```

Output: `txt-update/files/output.txt`
