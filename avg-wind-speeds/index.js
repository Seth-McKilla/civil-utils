/**
 * This script:
 * 1) Loops over NOAA historical data files for a given station (years 2015–2024).
 * 2) Filters the wind records by direction:
 *     - Only keep rows where the wind direction is within ±(directionTolerance) degrees
 *       of a specified fetchDirection (e.g., 120 ± 30 => keep 90–150°).
 * 3) From the filtered data, we collect all valid gust speeds.
 * 4) We then take only the top X% of gust speeds (where X = percentileValue; e.g., 10 => top 10%).
 * 5) Finally, we compute the average gust speed of that upper subset, and also print the subset’s size.
 *
 * Usage example:
 *   node avg-wind-speeds/ 120 30 10
 *   => direction=120°, tolerance=30°, top 10% of gust speeds in that range
 *
 * Adjust or wrap the code as needed for your environment or further analysis.
 */

const https = require("https");
const zlib = require("zlib");

// For convenience, we’ll read command-line arguments:
//   1) fetchDirection   (number, e.g. 120)
//   2) directionRange   (number, e.g. 30)
//   3) percentileValue  (number, e.g. 10 for upper 10%)
const fetchDirection = parseFloat(process.argv[2]);
const directionRange = parseFloat(process.argv[3]) || 30;
const percentileValue = parseFloat(process.argv[4]) || 1;

/**
 * If the user-provided direction ± tolerance crosses the 0°/360° boundary,
 * you might want to do a more robust wrap-around check.
 * For simplicity, we’ll assume directionRange is small enough
 * or fetchDirection is away from 0/360. If needed, you can handle that
 * by normalizing angles mod 360.
 */

// Master array of all gust speeds that pass the direction filter across all years
const validGusts = [];

/**
 * Check if a direction is within ±directionRange of fetchDirection, ignoring wrap-around complexities.
 * If needed, add logic for crossing 0/360 boundaries.
 */
function isDirectionInRange(wdir, target, tolerance) {
  return wdir >= target - tolerance && wdir <= target + tolerance;
}

/**
 * Process the decompressed file text for a particular year.
 * We parse each row and keep gust speeds that:
 *   - Are within the direction filter
 *   - Are valid (0 <= gust <= 90)
 *   - direction also valid (0 <= wdir <= 360)
 * Then push them into the global validGusts array.
 */
function parseFileAsText(fileText) {
  const lines = fileText.split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      continue; // skip header or empty
    }

    // NOAA columns:
    //  0: YY
    //  1: MM
    //  2: DD
    //  3: hh
    //  4: mm
    //  5: WDIR (deg)
    //  6: WSPD (m/s)
    //  7: GST  (m/s)
    // ...
    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;

    const wdir = parseFloat(columns[5]);
    const gst = parseFloat(columns[7]);

    // Basic validation
    if (isNaN(wdir) || wdir < 0 || wdir > 360) {
      continue;
    }
    if (isNaN(gst) || gst < 0 || gst > 90) {
      continue;
    }

    // Check if direction is in ±directionRange of fetchDirection
    if (isDirectionInRange(wdir, fetchDirection, directionRange)) {
      validGusts.push(gst);
    }
  }
}

/**
 * Downloads and processes a single year's data, adding to validGusts.
 */
function fetchAndProcessYear(year) {
  return new Promise((resolve, reject) => {
    const url = `https://www.ndbc.noaa.gov/view_text_file.php?filename=ncdv2h${year}.txt.gz&dir=data/historical/stdmet/`;

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

          // Check GZIP signature
          if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
            zlib.gunzip(body, (err, decompressed) => {
              if (err) return reject(err);
              parseFileAsText(decompressed.toString());
              resolve();
            });
          } else {
            // Possibly plain text or error HTML
            parseFileAsText(body.toString());
            resolve();
          }
        });

        res.on("error", (err) => reject(err));
      })
      .on("error", (err) => reject(err));
  });
}

async function main() {
  console.log(
    `\n>>> Fetch direction = ${fetchDirection}° ± ${directionRange}°`
  );
  console.log(`>>> Upper percentile selected = top ${percentileValue}%`);
  console.log("\nStarting data download and parsing...\n");

  // Fetch each year from 2015–2024
  for (let year = 2015; year <= 2024; year++) {
    console.log(`Fetching data for year ${year}...`);
    await fetchAndProcessYear(year);
  }

  console.log(
    `\nFiltering complete. Total data points matching direction criteria: ${validGusts.length}`
  );

  if (validGusts.length === 0) {
    console.log("No valid gust data found in that direction range. Exiting.");
    return;
  }

  // Sort descending
  validGusts.sort((a, b) => b - a);

  // e.g., if percentileValue = 10, we want the top 10% => 0.10 fraction
  const fraction = percentileValue / 100;
  const cutoffIndex = Math.floor(validGusts.length * fraction);

  // If top 10%, that means we keep the first cutoffIndex elements
  // in a descending list => that's the "upper 10%"
  if (cutoffIndex < 1) {
    console.log(
      `The dataset is too small for a top ${percentileValue}% subset. We'll just keep all data.`
    );
  }

  const subset =
    cutoffIndex >= 1 ? validGusts.slice(0, cutoffIndex) : validGusts;

  // Compute average of that subset
  const sum = subset.reduce((acc, val) => acc + val, 0);
  const avg = sum / subset.length;

  console.log(
    `\nTop ${subset.length} records ( = top ${percentileValue}% ) out of ${validGusts.length} total.`
  );
  console.log(`Average gust in that top subset: ${avg.toFixed(2)} m/s\n`);
}

main().catch((err) => {
  console.error("An error occurred:", err);
});
