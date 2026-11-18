/**
 * Projected wave heights on restricted fetches — Smith (1991),
 * "Wind-Wave Generation on Restricted Fetches", USACE CERC Misc. Paper CERC-91-2 (NARFET method).
 *
 * Inputs:
 *   1) Fetch lengths file (.xlsx / .xls / .csv) with columns "Layer, Length"
 *      where Layer is the direction (e.g. "_005", "_010", ... "_360") and Length is the fetch.
 *   2) Wind CSV output from avg-wind-speeds (columns: direction_deg, ..., avg_gust_ms).
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
 *   - Duration limits are NOT checked (no duration input) — results assume fetch-limited or fully developed.
 *
 * Usage:
 *   pnpm waves
 *   => uses the newest fetch file in wave-heights/input/ and the newest CSV in avg-wind-speeds/output/
 *
 *   node wave-heights [fetchFile] [windCsv] [--units ft] [--z 10] [--rt 1.1]
 *   --units: fetch length units (ft | m | mi | km | nmi), default ft
 *   --z:     anemometer height in metres, default 10
 *   --rt:    stability correction R_T, default 1.1
 */

const fs = require("fs");
const path = require("path");
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
const zArg = flags.z || "10";
const rtArg = flags.rt || "1.1";

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
      "  node wave-heights [fetchFile] [windCsv] [--units ft] [--z 10] [--rt 1.1]"
  );
  process.exit(1);
}

const unitFactor = UNIT_TO_M[unitsArg.toLowerCase()];
if (!unitFactor) {
  console.error(`Unknown fetch units "${unitsArg}". Use one of: ${Object.keys(UNIT_TO_M).join(", ")}`);
  process.exit(1);
}
const anemometerZ = parseFloat(zArg);
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

/** Read avg-wind-speeds CSV -> [{dir, u (m/s)}]. */
function readWinds(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  const iDir = header.indexOf("direction_deg");
  const iSpd = header.findIndex((h) => /gust|speed|_ms$/i.test(h) && h !== "direction_deg");
  if (iDir < 0 || iSpd < 0) throw new Error(`Wind CSV needs direction_deg and avg_gust_ms columns: ${file}`);
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
    .match(/^(.+?)_(\d{4})-(\d{4})_(?:all-dirs|dir[\d.]+)_range([\d.]+)_(?:top([\d.]+)pct|(max))/);
  if (!m) return "Wind statistic: see wind file";
  const [, station, y0, y1, range, pct, isMax] = m;
  const stat = isMax ? "maximum recorded gust" : `average of the top ${pct}% of gusts (${100 - parseFloat(pct)}th percentile and above)`;
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
  const radials = readFetches(fetchFile);
  const fetch = buildAveragedFetch(radials);
  const winds = readWinds(windFile);

  console.log(`\nFetch file: ${fetchFile} (units: ${unitsArg})`);
  console.log(`Wind file:  ${windFile}`);
  const windDesc = describeWind(windFile);
  console.log(windDesc);
  console.log(`Anemometer height: ${anemometerZ} m, stability R_T: ${stabilityRT}\n`);

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
  const outName = `waves_${path.basename(windFile, path.extname(windFile))}.csv`;
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
    settings: `Anemometer height ${anemometerZ} m · stability R_T ${stabilityRT} · fetch units ${unitsArg}`,
  });
  console.log(`PDF written to: ${pdfPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
