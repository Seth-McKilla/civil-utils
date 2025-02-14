const https = require("https");
const zlib = require("zlib");

// Determine meteorological season from month (1–12).
function getSeason(month) {
  if ([12, 1, 2].includes(month)) return "Winter";
  if ([3, 4, 5].includes(month)) return "Spring";
  if ([6, 7, 8].includes(month)) return "Summer";
  if ([9, 10, 11].includes(month)) return "Fall";
  return "Unknown";
}

/**
 * For each season in a given year, we store:
 *   - gstMax: the highest gust observed that season
 *   - dirSum: sum of all wind directions over that season
 *   - dirCount: number of direction readings for that season
 * This way, we can compute:
 *   - The maximum gust
 *   - The average direction (over ALL readings, not just at max gust)
 */
function initSeasonRecord() {
  return {
    gstMax: Number.NEGATIVE_INFINITY,
    dirSum: 0,
    dirCount: 0,
  };
}

/**
 * Parse the file text (once fully read/decompressed) for a given year,
 * filling out the seasonalData structure with maximum gust and
 * the sum/count of directions in that season.
 */
function parseFileAsText(fileText, year, seasonalData) {
  // Ensure the year is initialized in the main data structure.
  if (!seasonalData[year]) {
    seasonalData[year] = {
      Winter: initSeasonRecord(),
      Spring: initSeasonRecord(),
      Summer: initSeasonRecord(),
      Fall: initSeasonRecord(),
    };
  }

  const lines = fileText.split("\n");
  for (const line of lines) {
    // Skip headers or empty lines
    if (!line || line.startsWith("#")) continue;

    // Typical columns in NOAA data:
    // 0: YY (year)
    // 1: MM (month)
    // 2: DD (day)
    // 3: hh (hour)
    // 4: mm (minute)
    // 5: WDIR (wind direction, deg)
    // 6: WSPD (wind speed, m/s)
    // 7: GST  (gust, m/s)
    // ...
    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;

    const month = parseInt(columns[1], 10);
    const wdir = parseFloat(columns[5]); // wind direction
    const gst = parseFloat(columns[7]); // gust

    // Basic filtering for missing or suspicious data.
    // NOAA often uses 99, 999, 9999 for missing data.
    // We'll discard anything obviously invalid.
    if (
      isNaN(gst) ||
      gst < 0 ||
      gst > 90 ||
      isNaN(wdir) ||
      wdir < 0 ||
      wdir > 360
    ) {
      continue;
    }

    const season = getSeason(month);
    const record = seasonalData[year][season];

    // Track maximum gust
    if (gst > record.gstMax) {
      record.gstMax = gst;
    }

    // Accumulate direction sum/count for an average at the end
    record.dirSum += wdir;
    record.dirCount += 1;
  }
}

/**
 * Fetch and parse data for a single year, storing results in seasonalData.
 * If the server doesn't return a 200 or if the content is not valid GZIP,
 * we'll either skip or parse as plain text as needed.
 */
function fetchAndProcessYear(year, seasonalData) {
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

          // Check for GZIP signature (0x1f, 0x8b).
          if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
            zlib.gunzip(body, (err, decompressed) => {
              if (err) return reject(err);
              parseFileAsText(decompressed.toString(), year, seasonalData);
              resolve();
            });
          } else {
            // Plain text or error page, parse as-is.
            parseFileAsText(body.toString(), year, seasonalData);
            resolve();
          }
        });

        res.on("error", (err) => reject(err));
      })
      .on("error", (err) => reject(err));
  });
}

async function main() {
  /**
   * seasonalData structure for each year, e.g.:
   * {
   *   2015: {
   *     Winter: { gstMax, dirSum, dirCount },
   *     Spring: { gstMax, dirSum, dirCount },
   *     Summer: { gstMax, dirSum, dirCount },
   *     Fall:   { gstMax, dirSum, dirCount }
   *   },
   *   2016: { ... },
   *   ...
   * }
   */
  const seasonalData = {};

  // Download/parse each year from 2015–2024
  for (let year = 2015; year <= 2024; year++) {
    console.log(`Fetching data for year: ${year}`);
    await fetchAndProcessYear(year, seasonalData);
  }

  // For multi-year results, we’ll:
  //   - Gather each year's max GST per season to compute an "average of maxima" across years
  //   - Also gather direction sums across all data to find the overall average direction
  //     for the multi-year period (i.e., we sum up all dirSum, dirCount from each year).
  const multiYearAggregates = {
    Winter: { gstMaxSum: 0, gstMaxCount: 0, dirSum: 0, dirCount: 0 },
    Spring: { gstMaxSum: 0, gstMaxCount: 0, dirSum: 0, dirCount: 0 },
    Summer: { gstMaxSum: 0, gstMaxCount: 0, dirSum: 0, dirCount: 0 },
    Fall: { gstMaxSum: 0, gstMaxCount: 0, dirSum: 0, dirCount: 0 },
  };

  console.log(
    "\nPer-year seasonal results (max GST + average direction across the season):"
  );

  const sortedYears = Object.keys(seasonalData)
    .map(Number)
    .sort((a, b) => a - b);

  sortedYears.forEach((year) => {
    const recordBySeason = seasonalData[year];
    const rowOutput = [`Year ${year}:`];

    for (const season of ["Winter", "Spring", "Summer", "Fall"]) {
      const { gstMax, dirSum, dirCount } = recordBySeason[season];
      const gstVal = gstMax === Number.NEGATIVE_INFINITY ? null : gstMax;
      // Average direction for this season in this year
      let dirAvgVal = null;
      if (dirCount > 0) {
        dirAvgVal = dirSum / dirCount;
      }

      // Accumulate max GST into multi-year aggregator
      if (gstVal !== null) {
        multiYearAggregates[season].gstMaxSum += gstVal;
        multiYearAggregates[season].gstMaxCount += 1;
      }

      // Accumulate direction sums to get multi-year overall average direction
      if (dirAvgVal !== null) {
        // Instead of averaging the averages, we want the sum of raw directions.
        // But we only stored the sum for one year. We can store that directly:
        // We'll add the entire year's direction sum & count to the aggregator.
        multiYearAggregates[season].dirSum += dirSum;
        multiYearAggregates[season].dirCount += dirCount;
      }

      const gstStr = gstVal?.toFixed(2) ?? "N/A";
      const dirStr = dirAvgVal?.toFixed(1) ?? "N/A";
      rowOutput.push(`${season} MAX GST=${gstStr}, DIR(avg)=${dirStr}`);
    }

    console.log(rowOutput.join(" | "));
  });

  // Now compute the multi-year average of per-year max GST, plus the overall average direction
  // for each season (i.e. from all data points across all years).
  console.log("\nMulti-year results:");
  for (const season of ["Winter", "Spring", "Summer", "Fall"]) {
    const { gstMaxSum, gstMaxCount, dirSum, dirCount } =
      multiYearAggregates[season];

    // Average of the max gusts across the years
    const gstAvgMax =
      gstMaxCount > 0 ? (gstMaxSum / gstMaxCount).toFixed(2) : "N/A";

    // Average direction from all direction readings over all years
    const dirAvg = dirCount > 0 ? (dirSum / dirCount).toFixed(1) : "N/A";

    console.log(
      `${season}: GST avg of maxima = ${gstAvgMax}, DIR(avg) = ${dirAvg}`
    );
  }
}

main().catch((err) => {
  console.error("An error occurred:", err);
});
