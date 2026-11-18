/**
 * Projected wave heights on restricted fetches — Smith (1991),
 * "Wind-Wave Generation on Restricted Fetches", USACE CERC Misc. Paper CERC-91-2 (NARFET method).
 *
 * Inputs:
 *   1) Fetch lengths file (.xlsx / .xls / .csv) with columns "Layer, Length"
 *      where Layer is the direction (e.g. "_005", "_010", ... "_360") and Length is the fetch.
 *   2) Wind CSV output from avg-wind-speeds (columns: direction_deg, ..., avg_wspd_ms).
 *
 * Method (per Smith 1991):
 *   - Radial fetches are interpolated to 1° and averaged over 15° arcs centered on each 1°.
 *   - Wind speed is adjusted to 10 m elevation ((10/z)^(1/7)) and for stability (R_T, default 1.1),
 *     then converted to the SPM wind stress factor U_A = 0.71 * U^1.23 (m/s).
 *   - Wave direction: search ±90° from the wind direction for the angle φ that maximizes
 *       F^0.28 * cos(φ)^0.44                                  (Eq. 11)
 *   - Wave height / period (fetch limited):                     (Eq. 9)
 *       Hmo = 0.0015 * (U_A cosφ) * sqrt(F / g)
 *       Tp  = 0.3846 * (U_A cosφ)^0.44 * F^0.28 / g^0.72        (Tp = 1/fp, fp = 2.6 g^0.72 F^-0.28 (U_A cosφ)^-0.44)
 *   - Capped at SPM fully developed: Hmo = 0.2433 U_A^2 / g, Tp = 8.134 U_A / g.
 *   - Optional shallow water (--depth, average depth along the fetch in ft): per Smith (1991) para. 25, the
 *     Eq. 11 fetch is applied to the SPM (1984) shallow-water growth equations (Eqs. 3-39, 3-40) with U_A cosφ:
 *       gH/UA² = 0.283 tanh[0.530 (gd/UA²)^0.75] tanh{0.00565 (gF/UA²)^0.5 / tanh[0.530 (gd/UA²)^0.75]}
 *       gT/UA  = 7.54  tanh[0.833 (gd/UA²)^0.375] tanh{0.0379 (gF/UA²)^0.333 / tanh[0.833 (gd/UA²)^0.375]}
 *     The lower of the deep-water (Eq. 9) and shallow-water results is reported.
 *   - Duration limits are NOT checked (no duration input) — results assume fetch-limited or fully developed.
 *
 * Usage:
 *   pnpm waves
 *   => uses the newest fetch file in wave-heights/input/ and the newest CSV in avg-wind-speeds/output/
 *
 *   node wave-heights [fetchFile] [windCsv] [--rp 25] [--depth <ft>] [--units ft] [--z <m>] [--rt 1.1]
 *   --rp:    return period (yr) column to use from a return-period wind CSV, default 25
 *   --depth: average water depth along the fetch at the design water level (ft); omit for deep water
 *   --units: fetch length units (ft | m | mi | km | nmi), default ft
 *   --z:     anemometer height above water in metres; default: looked up from the NDBC station page
 *            (site elevation + anemometer height), falling back to 10 m
 *   --rt:    stability correction R_T, default 1.1
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const XLSX = require("xlsx");
const { writeRosePdf } = require("./rose-pdf");

const G = 9.81;
const M_TO_FT = 3.28084;
const UNIT_TO_M = { ft: 0.3048, m: 1, mi: 1609.344, km: 1000, nmi: 1852 };

// Args: optional file paths (positional) plus optional --units / --z / --rt flags
const args = process.argv.slice(2);
const flags = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
const unitsArg = flags.units || "ft";
const zArg = flags.z || null; // null => look up from NDBC station page
const rtArg = flags.rt || "1.1";
const returnPeriod = parseFloat(flags.rp || "25");
const depthFt = flags.depth ? parseFloat(flags.depth) : null;
const depthM = depthFt ? depthFt * 0.3048 : null;

/** Newest file in dir matching extension regex. */
function newestFile(dir, extRe) {
  if (!fs.existsSync(dir)) return null;
  const found = fs
    .readdirSync(dir)
    .filter((f) => extRe.test(f) && !f.startsWith("~$"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || null;
}

const fetchFile =
  files.find((f) => /\.(xlsx|xls)$/i.test(f)) ||
  newestFile(path.join(__dirname, "input"), /\.(xlsx|xls|csv)$/i);
const windFile =
  files.find((f) => /\.csv$/i.test(f) && f !== fetchFile) ||
  newestFile(path.join(__dirname, "..", "avg-wind-speeds", "output"), /\.csv$/i);

if (!fetchFile || !windFile) {
  console.log(
    "Put fetch lengths in wave-heights/input/ and run avg-wind-speeds first, or pass paths:\n" +
      "  node wave-heights [fetchFile] [windCsv] [--rp 25] [--depth <ft>] [--units ft] [--z <m>] [--rt 1.1]"
  );
  process.exit(1);
}

const unitFactor = UNIT_TO_M[unitsArg.toLowerCase()];
if (!unitFactor) {
  console.error(`Unknown fetch units "${unitsArg}". Use one of: ${Object.keys(UNIT_TO_M).join(", ")}`);
  process.exit(1);
}
let anemometerZ = zArg ? parseFloat(zArg) : null;
let zSource = "--z";

/** Fetch NDBC station page and return anemometer height above water (m), or null. */
function lookupAnemometerHeight(station) {
  const url = `https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(station.toLowerCase())}`;
  return new Promise((resolve) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let html = "";
        res.on("data", (c) => (html += c));
        res.on("end", () => {
          const text = html.replace(/<[^>]*>/g, " ");
          const anem = text.match(/Anemometer height:\s*([\d.]+)\s*m above site elevation/i);
          if (!anem) return resolve(null);
          const site = text.match(/Site elevation:\s*([\d.]+)\s*m above mean sea level/i);
          resolve(parseFloat(anem[1]) + (site ? parseFloat(site[1]) : 0));
        });
      })
      .on("error", () => resolve(null));
  });
}
const stabilityRT = parseFloat(rtArg);

const norm = (d) => ((Math.round(d) % 360) + 360) % 360;
const rad = (d) => (d * Math.PI) / 180;

/** Read fetch file -> Map(direction° -> fetch in metres). */
function readFetches(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const fetches = new Map();
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const dir = parseFloat(String(row[0]).replace(/[^0-9.\-]/g, ""));
    const len = parseFloat(row[1]);
    if (isNaN(dir) || isNaN(len)) continue;
    fetches.set(norm(dir), len * unitFactor);
  }
  if (fetches.size === 0) throw new Error(`No fetch data found in ${file}`);
  return fetches;
}

/** Interpolate radials to 1° around 360°, then average over 15° arcs (±7°) centered on each 1°. */
function buildAveragedFetch(radials) {
  const dirs = [...radials.keys()].sort((a, b) => a - b);
  const oneDeg = new Array(360);
  for (let d = 0; d < 360; d++) {
    // find bracketing radials (with wrap-around)
    let lo = dirs[dirs.length - 1] - 360;
    let hi = dirs[0] + 360;
    for (const r of dirs) {
      if (r <= d) lo = r;
      if (r >= d) { hi = r; break; }
    }
    const fLo = radials.get(norm(lo));
    const fHi = radials.get(norm(hi));
    oneDeg[d] = hi === lo ? fLo : fLo + ((fHi - fLo) * (d - lo)) / (hi - lo);
  }
  const averaged = new Array(360);
  for (let d = 0; d < 360; d++) {
    let sum = 0;
    for (let k = -7; k <= 7; k++) sum += oneDeg[norm(d + k)];
    averaged[d] = sum / 15;
  }
  return averaged;
}

/** Read avg-wind-speeds CSV -> [{dir, u (m/s)}]. Return-period CSVs use the rp<T>_wspd_ms column. */
function readWinds(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  const iDir = header.indexOf("direction_deg");
  const isRp = header.some((h) => /^rp\d+_wspd_ms$/.test(h));
  const iSpd = isRp ? header.indexOf(`rp${returnPeriod}_wspd_ms`) : header.indexOf("avg_wspd_ms");
  if (isRp && iSpd < 0) {
    const avail = header.filter((h) => /^rp\d+/.test(h)).map((h) => h.match(/\d+/)[0]);
    throw new Error(`No ${returnPeriod}-yr column in ${file}. Available --rp values: ${avail.join(", ")}`);
  }
  if (iDir < 0 || iSpd < 0) throw new Error(`Wind CSV needs direction_deg and avg_wspd_ms (or rp<T>_wspd_ms) columns: ${file}`);
  return lines
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => ({ dir: parseFloat(c[iDir]), u: parseFloat(c[iSpd]) }))
    .filter((w) => !isNaN(w.dir) && !isNaN(w.u));
}

/** Describe the wind statistic from the avg-wind-speeds filename, e.g. 44062_2010-2025_all-dirs_range15_top1pct.csv */
function describeWind(file) {
  const m = path
    .basename(file)
    .match(/^(.+?)_(\d{4})-(\d{4})_(?:all-dirs|dir[\d.]+)_range([\d.]+)_(?:top([\d.]+)pct|(max)|(rp))/);
  if (!m) return "Wind statistic: see wind file";
  const [, station, y0, y1, range, pct, isMax, isRp] = m;
  const stat = isRp
    ? `${returnPeriod}-year return period 1-hr sustained wind (hourly-avg WSPD, Gumbel fit of annual maxima)`
    : isMax ? "maximum recorded sustained wind (WSPD)" : `average of the top ${pct}% of sustained wind speeds (WSPD, ${100 - parseFloat(pct)}th percentile and above)`;
  return `Wind: NDBC station ${station.toUpperCase()}, ${y0}-${y1}, ${stat}, directions binned ±${range}°`;
}

/** Smith (1991) restricted-fetch wave for one wind direction/speed. */
function computeWave(windDir, u, fetch) {
  const u10 = u * Math.pow(10 / anemometerZ, 1 / 7) * stabilityRT;
  const ua = 0.71 * Math.pow(u10, 1.23);

  // Eq. 11: wave direction maximizing F^0.28 cos(φ)^0.44, searched ±90° (φ = 0..89)
  const center = norm(windDir);
  let best = { prod: -1 };
  for (let phi = 0; phi < 90; phi++) {
    const kPos = norm(center + phi);
    const kNeg = norm(center - phi);
    const k = fetch[kNeg] > fetch[kPos] ? kNeg : kPos;
    const F = fetch[k];
    const prod = Math.pow(F, 0.28) * Math.pow(Math.cos(rad(phi)), 0.44);
    if (prod > best.prod) best = { prod, phi, waveDir: k, F };
  }

  const uc = ua * Math.cos(rad(best.phi));
  let H = 0.0015 * uc * Math.sqrt(best.F / G);
  let T = (Math.pow(uc, 0.44) * Math.pow(best.F, 0.28)) / (2.6 * Math.pow(G, 0.72));
  let condition = "fetch-limited";

  // SPM (1984) shallow-water growth with the Smith fetch and wind component
  if (depthM) {
    const dStar = (G * depthM) / (uc * uc);
    const fStar = (G * best.F) / (uc * uc);
    const tH = Math.tanh(0.53 * Math.pow(dStar, 0.75));
    const tT = Math.tanh(0.833 * Math.pow(dStar, 0.375));
    const hShallow = ((0.283 * tH * Math.tanh((0.00565 * Math.sqrt(fStar)) / tH)) * uc * uc) / G;
    const tShallow = (7.54 * tT * Math.tanh((0.0379 * Math.pow(fStar, 1 / 3)) / tT) * uc) / G;
    if (hShallow < H) {
      H = hShallow;
      T = Math.min(T, tShallow);
      condition = "depth-limited";
    }
  }

  const hFull = (0.2433 * ua * ua) / G;
  const tFull = (8.134 * ua) / G;
  if (H > hFull || T > tFull) {
    H = Math.min(H, hFull);
    T = Math.min(T, tFull);
    condition = "fully-developed";
  }

  return { u10, ua, ...best, H, T, condition };
}

async function main() {
  if (anemometerZ === null) {
    const station = path.basename(windFile).split("_")[0];
    const z = await lookupAnemometerHeight(station);
    if (z) {
      anemometerZ = z;
      zSource = `NDBC station page for ${station.toUpperCase()}`;
    } else {
      anemometerZ = 10;
      zSource = `default - could not look up ${station.toUpperCase()} on NDBC; pass --z to set it`;
      console.warn(`\nWARNING: could not read anemometer height for station "${station}" from NDBC. Using 10 m. Pass --z <m> to override.`);
    }
  }
  const radials = readFetches(fetchFile);
  const fetch = buildAveragedFetch(radials);
  const winds = readWinds(windFile);

  console.log(`\nFetch file: ${fetchFile} (units: ${unitsArg})`);
  console.log(`Wind file:  ${windFile}`);
  const windDesc = describeWind(windFile);
  console.log(windDesc);
  console.log(`Anemometer height: ${anemometerZ} m above water (${zSource}), stability R_T: ${stabilityRT}`);
  console.log(depthFt ? `Average fetch depth: ${depthFt} ft (SPM shallow-water growth)\n` : "Deep water (no --depth given)\n");

  const header = ["Wind Dir", "U (m/s)", "UA (m/s)", "Wave Dir", "φ (°)", "Fetch (ft)", "Hmo (ft)", "Tp (s)", "Condition"];
  const widths = [9, 9, 9, 9, 6, 11, 9, 7, 16];
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(" ");
  console.log(fmt(header));
  console.log("-".repeat(fmt(header).length));

  const rows = [];
  for (const { dir, u } of winds) {
    const r = computeWave(dir, u, fetch);
    const row = {
      dir,
      u: u.toFixed(2),
      ua: r.ua.toFixed(2),
      waveDir: r.waveDir,
      phi: r.phi,
      fetchFt: (r.F * M_TO_FT).toFixed(0),
      hFt: (r.H * M_TO_FT).toFixed(2),
      tp: r.T.toFixed(2),
      condition: r.condition,
    };
    rows.push(row);
    console.log(fmt(Object.values(row)));
  }

  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const rpTag = /_rp\.csv$/.test(windFile) ? `${returnPeriod}` : "";
  const depthTag = depthFt ? `_d${depthFt}ft` : "";
  const outName = `waves_${path.basename(windFile, path.extname(windFile))}${rpTag}${depthTag}.csv`;
  const outPath = path.join(outDir, outName);
  fs.writeFileSync(
    outPath,
    [
      "wind_dir_deg,wind_speed_ms,wind_stress_factor_ua_ms,wave_dir_deg,phi_deg,eff_fetch_ft,hmo_ft,tp_s,condition",
      ...rows.map((r) => Object.values(r).join(",")),
    ].join("\n") + "\n"
  );
  console.log(`\nCSV written to: ${outPath}`);

  const pdfPath = outPath.replace(/\.csv$/, ".pdf");
  await writeRosePdf(pdfPath, {
    rows,
    radialsFt: [...radials].map(([dir, m]) => ({ dir, ft: m * M_TO_FT })),
    fetchFile: path.basename(fetchFile),
    windFile: path.basename(windFile),
    windDesc,
    settings: `Anemometer height ${anemometerZ} m above water (${zSource}) · stability R_T ${stabilityRT} · fetch units ${unitsArg} · ${
      depthFt ? `avg fetch depth ${depthFt} ft (SPM 1984 shallow-water growth)` : "deep water"
    }`,
  });
  console.log(`PDF written to: ${pdfPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
