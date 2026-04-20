/**
 * This script:
 * 1) Loops over NOAA historical data files for a given station (years startYear–endYear).
 * 2) Filters the wind records by direction:
 *     - Single direction: only keep rows within ±directionRange° of fetchDirection.
 *     - All directions: collect every valid record, then compute results for each 5° step (0–355°).
 * 3) From the filtered data, collect all valid gust speeds.
 * 4) Take only the top X% of gust speeds (where X = percentileValue; e.g., 1 => top 1%).
 * 5) Compute the average gust speed of that upper subset and print the subset's size.
 *
 * Usage examples:
 *   node avg-wind-speeds/ ncdv2 2015 2024 120 15 1
 *   => station=ncdv2, start=2015, end=2024, direction=120°, tolerance=±15°, top 1% of gusts
 *
 *   node avg-wind-speeds/ ncdv2 2015 2024 all 15 1
 *   => same station/years, but computes results for every 5° direction (0°, 5°, 10°, ..., 355°)
 */

const https = require("https");
const zlib = require("zlib");

const stationId = process.argv[2];
const startYear = parseInt(process.argv[3]);
const endYear = parseInt(process.argv[4]);
const fetchDirectionArg = process.argv[5];
const directionRange = parseFloat(process.argv[6]) || 15;
const percentileValue = parseFloat(process.argv[7]) || 1;

const isAllDirections = fetchDirectionArg === "all";
const fetchDirection = isAllDirections ? null : parseFloat(fetchDirectionArg);

// Single-direction mode: accumulate matching gust speeds directly
const validGusts = [];
// All-directions mode: accumulate every valid {wdir, gst} record, filter per direction after
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
 *   5: WDIR (deg)  6: WSPD (m/s)  7: GST (m/s)  ...
 */
function parseFileAsText(fileText) {
  const lines = fileText.split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;

    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;

    const wdir = parseFloat(columns[5]);
    const gst = parseFloat(columns[7]);

    if (isNaN(wdir) || wdir < 0 || wdir > 360) continue;
    if (isNaN(gst) || gst < 0 || gst > 90) continue;

    if (isAllDirections) {
      allRecords.push({ wdir, gst });
    } else if (isDirectionInRange(wdir, fetchDirection, directionRange)) {
      validGusts.push(gst);
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
 * Compute and print percentile-average gust speed for a set of gust values.
 * Returns the result object, or null if no data.
 */
function computePercentileAvg(gusts) {
  if (gusts.length === 0) return null;

  gusts.sort((a, b) => b - a);

  const fraction = percentileValue / 100;
  const cutoffIndex = Math.floor(gusts.length * fraction);
  const subset = cutoffIndex >= 1 ? gusts.slice(0, cutoffIndex) : gusts;
  const avg = subset.reduce((acc, val) => acc + val, 0) / subset.length;

  return { total: gusts.length, subsetSize: subset.length, avg };
}

function computeSingleDirection() {
  console.log(
    `\nFiltering complete. Total data points matching direction criteria: ${validGusts.length}`
  );

  if (validGusts.length === 0) {
    console.log("No valid gust data found in that direction range. Exiting.");
    return;
  }

  const result = computePercentileAvg(validGusts);

  if (result.subsetSize < 1) {
    console.log(
      `The dataset is too small for a top ${percentileValue}% subset. Showing all data.`
    );
  }

  console.log(
    `\nTop ${result.subsetSize} records ( = top ${percentileValue}% ) out of ${result.total} total.`
  );
  console.log(`Average gust in that top subset: ${result.avg.toFixed(2)} m/s\n`);
}

function computeAllDirections() {
  console.log(`\nTotal valid records collected: ${allRecords.length}\n`);

  const header = [
    "Dir (°)".padEnd(10),
    "Total".padEnd(8),
    `Top ${percentileValue}%`.padEnd(10),
    "Avg Gust (m/s)",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (let dir = 0; dir < 360; dir += 5) {
    const gusts = allRecords
      .filter((r) => isDirectionInRange(r.wdir, dir, directionRange))
      .map((r) => r.gst);

    if (gusts.length === 0) {
      console.log(
        `${String(dir).padEnd(10)} ${"0".padEnd(8)} ${"0".padEnd(10)} N/A`
      );
      continue;
    }

    const result = computePercentileAvg(gusts);
    console.log(
      `${String(dir).padEnd(10)} ${String(result.total).padEnd(8)} ${String(result.subsetSize).padEnd(10)} ${result.avg.toFixed(2)}`
    );
  }

  console.log();
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
  console.log(`>>> Upper percentile selected = top ${percentileValue}%`);
  console.log("\nStarting data download and parsing...\n");

  for (let year = startYear; year <= endYear; year++) {
    console.log(`Fetching data for year ${year}...`);
    await fetchAndProcessYear(year);
  }

  if (isAllDirections) {
    computeAllDirections();
  } else {
    computeSingleDirection();
  }
}

main().catch((err) => {
  console.error("An error occurred:", err);
});
