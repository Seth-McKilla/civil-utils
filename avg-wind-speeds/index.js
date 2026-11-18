/**
 * This script:
 * 1) Loops over NOAA historical data files for a given station (years startYear–endYear).
 * 2) Filters the wind records by direction:
 *     - Single direction: only keep rows within ±directionRange° of fetchDirection.
 *     - All directions: collect every valid record, then compute results for each 5° step (0–355°).
 * 3) From the filtered data, collect all valid sustained wind speeds (WSPD — gusts are not used).
 * 4) Mode (last argument):
 *     - rp (default): extreme value analysis. WSPD records are averaged to hourly winds (≈1-hr sustained,
 *       consistent with SPM / Smith 1991 wave growth; also filters out minutes-long thunderstorm spikes),
 *       then the annual maximum hourly wind per direction is fit with a Gumbel distribution (method of
 *       moments) -> 10, 25, 50 and 100-year return period winds.
 *     - X (number):   average of the top X% of wind speeds (e.g. 1 => top 1%).
 *     - max:          single highest recorded wind speed.
 *
 * Usage examples:
 *   node avg-wind-speeds/ 44062 2010 2025 all 15
 *   => 10/25/50/100-yr return period sustained winds for every 5° direction (± 15°)
 *
 *   node avg-wind-speeds/ ncdv2 2015 2024 120 15 1
 *   => station=ncdv2, start=2015, end=2024, direction=120°, tolerance=±15°, top 1% of speeds
 *
 *   node avg-wind-speeds/ ncdv2 2015 2024 all 15 1
 *   => same station/years, but computes results for every 5° direction (0°, 5°, 10°, ..., 355°)
 *
 *   node avg-wind-speeds/ ncdv2 2015 2024 120 15 max
 *   => same as first example but returns the single highest recorded sustained wind speed instead of a percentile average
 *
 *   node avg-wind-speeds/ ncdv2 2015 2024 all 15 max
 *   => all 5° directions, each returning its single highest recorded sustained wind speed
 */

const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const stationId = process.argv[2];
const startYear = parseInt(process.argv[3]);
const endYear = parseInt(process.argv[4]);
const fetchDirectionArg = process.argv[5];
const directionRange = parseFloat(process.argv[6]) || 15;
const percentileArg = process.argv[7] || "rp";
const isRpMode = percentileArg === "rp";
const isMaxMode = percentileArg === "max";
const percentileValue = isMaxMode || isRpMode ? null : parseFloat(percentileArg) || 1;

const RETURN_PERIODS = [10, 25, 50, 100];
// Years with fewer valid records than this fraction of the median year are skipped (partial deployments/outages)
const MIN_YEAR_COVERAGE = 0.5;
// Minimum number of annual maxima needed to fit a direction
const MIN_YEARS = 5;
// Minimum records within a clock hour to form an hourly average
const MIN_RECORDS_PER_HOUR = 3;

const isAllDirections = fetchDirectionArg === "all";
const fetchDirection = isAllDirections ? null : parseFloat(fetchDirectionArg);

// Single-direction mode: accumulate matching sustained wind speeds directly
const validSpeeds = [];
// All-directions mode: accumulate every valid {wdir, wspd} record, filter per direction after
const allRecords = [];

/**
 * Angular distance between two directions, accounting for the 0°/360° wrap-around.
 */
function isDirectionInRange(wdir, target, tolerance) {
  const diff = Math.abs(((wdir - target + 180 + 360) % 360) - 180);
  return diff <= tolerance;
}

/**
 * Parse decompressed NOAA file text and push matching records into the appropriate store.
 *
 * NOAA stdmet columns:
 *   0: YY  1: MM  2: DD  3: hh  4: mm
 *   5: WDIR (deg)  6: WSPD (m/s, sustained: 8-min avg on buoys, 2-min on C-MAN)  ...
 */
function parseFileAsText(fileText) {
  const lines = fileText.split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;

    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;

    const wdir = parseFloat(columns[5]);
    const wspd = parseFloat(columns[6]);

    if (isNaN(wdir) || wdir < 0 || wdir > 360) continue;
    if (isNaN(wspd) || wspd < 0 || wspd > 90) continue;

    if (isRpMode) {
      allRecords.push({ hourKey: columns.slice(0, 4).join("-"), year: parseInt(columns[0]), wdir, wspd });
    } else if (isAllDirections) {
      allRecords.push({ wdir, wspd });
    } else if (isDirectionInRange(wdir, fetchDirection, directionRange)) {
      validSpeeds.push(wspd);
    }
  }
}

/**
 * Download and parse a single year's data file.
 */
function fetchAndProcessYear(year) {
  return new Promise((resolve, reject) => {
    const url = `https://www.ndbc.noaa.gov/view_text_file.php?filename=${stationId}h${year}.txt.gz&dir=data/historical/stdmet/`;

    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          console.warn(`Year ${year}: status code ${res.statusCode}, skipping`);
          res.resume();
          return resolve();
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);

          if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
            zlib.gunzip(body, (err, decompressed) => {
              if (err) return reject(err);
              parseFileAsText(decompressed.toString());
              resolve();
            });
          } else {
            parseFileAsText(body.toString());
            resolve();
          }
        });

        res.on("error", (err) => reject(err));
      })
      .on("error", (err) => reject(err));
  });
}

/**
 * Compute and print percentile-average sustained wind speed for a set of WSPD values.
 * Returns the result object, or null if no data.
 */
function computePercentileAvg(speeds) {
  if (speeds.length === 0) return null;

  speeds.sort((a, b) => b - a);

  if (isMaxMode) {
    return { total: speeds.length, subsetSize: 1, avg: speeds[0] };
  }

  const fraction = percentileValue / 100;
  const cutoffIndex = Math.floor(speeds.length * fraction);
  const subset = cutoffIndex >= 1 ? speeds.slice(0, cutoffIndex) : speeds;
  const avg = subset.reduce((acc, val) => acc + val, 0) / subset.length;

  return { total: speeds.length, subsetSize: subset.length, avg };
}

function writeCsv(rows, filename) {
  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  const lines = [
    "direction_deg,total_records,top_n_records,avg_wspd_ms",
    ...rows.map(
      (r) =>
        `${r.dir},${r.total},${r.subsetSize},${
          r.avg !== null ? r.avg.toFixed(2) : ""
        }`
    ),
  ];
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  console.log(`CSV written to: ${filePath}`);
}

function computeSingleDirection() {
  console.log(
    `\nFiltering complete. Total data points matching direction criteria: ${validSpeeds.length}`
  );

  if (validSpeeds.length === 0) {
    console.log("No valid wind speed data found in that direction range. Exiting.");
    return;
  }

  const result = computePercentileAvg(validSpeeds);

  if (result.subsetSize < 1) {
    console.log(
      `The dataset is too small for a top ${percentileValue}% subset. Showing all data.`
    );
  }

  if (isMaxMode) {
    console.log(
      `\nMax sustained wind speed: ${result.avg.toFixed(2)} m/s (from ${
        result.total
      } total records)\n`
    );
  } else {
    console.log(
      `\nTop ${result.subsetSize} records ( = top ${percentileValue}% ) out of ${result.total} total.`
    );
    console.log(
      `Average sustained wind speed in that top subset: ${result.avg.toFixed(2)} m/s\n`
    );
  }

  const filename = `${stationId}_${startYear}-${endYear}_dir${fetchDirection}_range${directionRange}_${
    isMaxMode ? "max" : `top${percentileValue}pct`
  }.csv`;
  writeCsv([{ dir: fetchDirection, ...result }], filename);
}

function computeAllDirections() {
  console.log(`\nTotal valid records collected: ${allRecords.length}\n`);

  const header = [
    "Dir (°)".padEnd(10),
    "Total".padEnd(8),
    (isMaxMode ? "Max" : `Top ${percentileValue}%`).padEnd(10),
    "Avg WSPD (m/s)",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  const rows = [];

  for (let dir = 0; dir < 360; dir += 5) {
    const speeds = allRecords
      .filter((r) => isDirectionInRange(r.wdir, dir, directionRange))
      .map((r) => r.wspd);

    if (speeds.length === 0) {
      console.log(
        `${String(dir).padEnd(10)} ${"0".padEnd(8)} ${"0".padEnd(10)} N/A`
      );
      rows.push({ dir, total: 0, subsetSize: 0, avg: null });
      continue;
    }

    const result = computePercentileAvg(speeds);
    console.log(
      `${String(dir).padEnd(10)} ${String(result.total).padEnd(8)} ${String(
        result.subsetSize
      ).padEnd(10)} ${result.avg.toFixed(2)}`
    );
    rows.push({ dir, ...result });
  }

  console.log();

  const filename = `${stationId}_${startYear}-${endYear}_all-dirs_range${directionRange}_${
    isMaxMode ? "max" : `top${percentileValue}pct`
  }.csv`;
  writeCsv(rows, filename);
}

/**
 * Gumbel (EV1) fit by method of moments; returns x_T for each return period T (years).
 */
function gumbelReturnLevels(annualMaxima) {
  const n = annualMaxima.length;
  const mean = annualMaxima.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(annualMaxima.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const alpha = (sd * Math.sqrt(6)) / Math.PI;
  const u = mean - 0.5772 * alpha;
  const levels = {};
  for (const T of RETURN_PERIODS) levels[T] = u - alpha * Math.log(-Math.log(1 - 1 / T));
  return { n, mean, sd, levels };
}

/**
 * Average raw records into hourly winds: scalar mean speed, vector-mean direction.
 */
function toHourly(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.hourKey)) groups.set(r.hourKey, []);
    groups.get(r.hourKey).push(r);
  }
  const hourly = [];
  for (const recs of groups.values()) {
    if (recs.length < MIN_RECORDS_PER_HOUR) continue;
    let sx = 0, sy = 0, sum = 0;
    for (const r of recs) {
      const a = (r.wdir * Math.PI) / 180;
      sx += r.wspd * Math.sin(a);
      sy += r.wspd * Math.cos(a);
      sum += r.wspd;
    }
    const wdir = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
    hourly.push({ year: recs[0].year, wdir, wspd: sum / recs.length });
  }
  return hourly;
}

function computeReturnPeriods() {
  // Year coverage check (raw records)
  const perYear = {};
  for (const r of allRecords) perYear[r.year] = (perYear[r.year] || 0) + 1;
  const counts = Object.values(perYear).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] || 0;
  const goodYears = new Set(
    Object.keys(perYear)
      .filter((y) => perYear[y] >= MIN_YEAR_COVERAGE * median)
      .map(Number)
  );
  console.log(`\nTotal valid records collected: ${allRecords.length}`);
  console.log("Records per year:");
  for (const y of Object.keys(perYear).sort()) {
    console.log(`  ${y}: ${perYear[y]}${goodYears.has(Number(y)) ? "" : "  (low coverage - skipped)"}`);
  }
  console.log(`Years used: ${goodYears.size}`);

  const hourly = toHourly(allRecords);
  console.log(`Hourly-averaged winds: ${hourly.length}\n`);

  const dirs = isAllDirections ? Array.from({ length: 72 }, (_, i) => i * 5) : [fetchDirection];
  const header = ["Dir (°)".padEnd(9), "Years".padEnd(7), "Mean max".padEnd(10), ...RETURN_PERIODS.map((T) => `${T}-yr`.padEnd(8))].join(" ");
  console.log("Hourly-averaged sustained wind (WSPD, m/s), Gumbel fit of annual maxima");
  console.log(header);
  console.log("-".repeat(header.length));

  const rows = [];
  for (const dir of dirs) {
    const annualMax = {};
    for (const r of hourly) {
      if (!goodYears.has(r.year) || !isDirectionInRange(r.wdir, dir, directionRange)) continue;
      if (!(r.year in annualMax) || r.wspd > annualMax[r.year]) annualMax[r.year] = r.wspd;
    }
    const maxima = Object.values(annualMax);
    if (maxima.length < MIN_YEARS) {
      console.log(`${String(dir).padEnd(9)} ${String(maxima.length).padEnd(7)} insufficient data`);
      rows.push({ dir, n: maxima.length, mean: null, sd: null, levels: {} });
      continue;
    }
    const fit = gumbelReturnLevels(maxima);
    console.log(
      [String(dir).padEnd(9), String(fit.n).padEnd(7), fit.mean.toFixed(2).padEnd(10), ...RETURN_PERIODS.map((T) => fit.levels[T].toFixed(2).padEnd(8))].join(" ")
    );
    rows.push({ dir, ...fit });
  }

  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${stationId}_${startYear}-${endYear}_${isAllDirections ? "all-dirs" : `dir${fetchDirection}`}_range${directionRange}_rp.csv`;
  const filePath = path.join(outputDir, filename);
  const fmt = (v) => (v === null || v === undefined ? "" : v.toFixed(2));
  fs.writeFileSync(
    filePath,
    [
      `direction_deg,years,mean_annual_max_ms,std_annual_max_ms,${RETURN_PERIODS.map((T) => `rp${T}_wspd_ms`).join(",")}`,
      ...rows.map((r) => [r.dir, r.n, fmt(r.mean), fmt(r.sd), ...RETURN_PERIODS.map((T) => fmt(r.levels[T]))].join(",")),
    ].join("\n") + "\n"
  );
  console.log(`\nCSV written to: ${filePath}`);
}

async function main() {
  if (isAllDirections) {
    console.log(
      `\n>>> Mode: all directions (5° increments) ± ${directionRange}°`
    );
  } else {
    console.log(
      `\n>>> Fetch direction = ${fetchDirection}° ± ${directionRange}°`
    );
  }
  console.log(
    `>>> Mode = ${isRpMode ? "return period (Gumbel fit of annual maxima)" : isMaxMode ? "max sustained wind" : `top ${percentileValue}%`}`
  );
  console.log("\nStarting data download and parsing...\n");

  for (let year = startYear; year <= endYear; year++) {
    console.log(`Fetching data for year ${year}...`);
    await fetchAndProcessYear(year);
  }

  if (isRpMode) {
    computeReturnPeriods();
  } else if (isAllDirections) {
    computeAllDirections();
  } else {
    computeSingleDirection();
  }
}

main().catch((err) => {
  console.error("An error occurred:", err);
});
