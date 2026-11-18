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
| [avg-wind-speeds](#avg-wind-speeds) | `pnpm wind` | Design wind gust speeds by direction from NOAA NDBC historical data |
| [wave-heights](#wave-heights) | `pnpm waves` | Projected wave heights on restricted fetches (Smith 1991) + wave rose PDF |
| [adjacent-properties](#adjacent-properties) | `pnpm props` | Owner names and mailing addresses from MD SDAT property pages |
| [kml2mdspnad83ftcsv](#kml2mdspnad83ftcsv) | `pnpm kml2csv` | KML points → MD State Plane NAD83 (US ft) CSV |
| [txt-update](#txt-update) | `pnpm txtupdate` | Filter a point file by description and renumber points |

---

## avg-wind-speeds

Downloads NOAA NDBC historical standard meteorological data for a station, filters gusts by direction, and averages the top X% of gusts (or takes the single maximum).

```bash
pnpm wind <station> <startYear> <endYear> <direction|all> [range=15] [percentile=1|max]
```

| Argument | Description |
|---|---|
| `station` | NDBC station ID, e.g. `44062`, `ocim2` |
| `startYear` / `endYear` | Range of years to download |
| `direction` | Wind direction in degrees, or `all` for every 5° (0–355°) |
| `range` | ± degrees around each direction to include (default 15) |
| `percentile` | Average the top X% of gusts (default `1`), or `max` for the single highest gust |

Examples:

```bash
pnpm wind 44062 2010 2025 all 15 1     # top 1% avg gust for every 5° direction
pnpm wind ocim2 2008 2025 40 15 1      # single direction, 40° ± 15°
pnpm wind 44062 2010 2025 all 15 max   # max gust for every 5° direction
```

Output: `avg-wind-speeds/output/<station>_<start>-<end>_<dir<deg>|all-dirs>_range<range>_<top<X>pct|max>.csv` with columns `direction_deg, total_records, top_n_records, avg_gust_ms` (m/s).

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
| `--z` | `10` | Anemometer height (m). The wind is adjusted to 10 m by (10/z)^(1/7). NDBC buoys are typically ~3.8 m. |
| `--rt` | `1.1` | Air–sea stability factor R_T (1.1 = unstable/unknown, per SPM) |

Example: `pnpm waves --z 3.8`

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

Limitations:
- Duration limits are not checked.
- Gust speeds from `avg-wind-speeds` are used as-is. They are not converted to longer averaging times, so results are conservative.

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
