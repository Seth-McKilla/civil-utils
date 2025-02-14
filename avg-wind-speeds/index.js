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

// Each record will track the maximum WSPD and GST for that season in a given year.
function initSeasonRecord() {
  return {
    WSPD_max: Number.NEGATIVE_INFINITY,
    GST_max: Number.NEGATIVE_INFINITY,
  };
}

// Parse raw file text into the seasonalData structure.
function parseFileAsText(fileText, year, seasonalData) {
  const lines = fileText.split("\n");

  // Ensure the year is initialized in the main data structure.
  if (!seasonalData[year]) {
    seasonalData[year] = {
      Winter: initSeasonRecord(),
      Spring: initSeasonRecord(),
      Summer: initSeasonRecord(),
      Fall: initSeasonRecord(),
    };
  }

  for (const line of lines) {
    // Skip header or empty lines
    if (!line || line.startsWith("#")) continue;

    // Columns: YY, MM, DD, hh, mm, WDIR, WSPD, GST, ...
    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;

    // We care about year, month, WSPD (col 6), and GST (col 7).
    const fileYear = parseInt(columns[0], 10);
    const month = parseInt(columns[1], 10);
    const wspd = parseFloat(columns[6]);
    const gst = parseFloat(columns[7]);

    // Filter out missing or suspicious data (e.g. 99.00).
    if (
      isNaN(wspd) ||
      isNaN(gst) ||
      wspd > 90 ||
      gst > 90 ||
      wspd < 0 ||
      gst < 0
    ) {
      continue;
    }

    const season = getSeason(month);
    const record = seasonalData[year][season];

    // Update max if current row is higher.
    if (wspd > record.WSPD_max) {
      record.WSPD_max = wspd;
    }
    if (gst > record.GST_max) {
      record.GST_max = gst;
    }
  }
}

// Download + process data for a single year.
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

          // Check GZIP signature (0x1f, 0x8b).
          if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
            zlib.gunzip(body, (err, decompressed) => {
              if (err) return reject(err);
              parseFileAsText(decompressed.toString(), year, seasonalData);
              resolve();
            });
          } else {
            // Plain text or error page, parse as-is
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
  // Data structure:
  // {
  //   [year]: {
  //     Winter: { WSPD_max, GST_max },
  //     Spring: { ... },
  //     Summer: { ... },
  //     Fall:   { ... }
  //   }
  // }
  const seasonalData = {};

  // Fetch each year 2015–2024
  for (let year = 2015; year <= 2024; year++) {
    console.log(`Fetching data for year: ${year}`);
    await fetchAndProcessYear(year, seasonalData);
  }

  // For our multi-year results, we want the “averaged maximum.”
  // That means we’ll collect the “maximum per year (per season)” and then average those maxima over all years.
  const multiYearAggregates = {
    Winter: { WSPD_maxSum: 0, WSPD_count: 0, GST_maxSum: 0, GST_count: 0 },
    Spring: { WSPD_maxSum: 0, WSPD_count: 0, GST_maxSum: 0, GST_count: 0 },
    Summer: { WSPD_maxSum: 0, WSPD_count: 0, GST_maxSum: 0, GST_count: 0 },
    Fall: { WSPD_maxSum: 0, WSPD_count: 0, GST_maxSum: 0, GST_count: 0 },
  };

  // Print per-year maximum results
  console.log("\nPer-year seasonal maximum (WSPD, GST):");
  const sortedYears = Object.keys(seasonalData)
    .map(Number)
    .sort((a, b) => a - b);

  sortedYears.forEach((year) => {
    const record = seasonalData[year];
    const rowOutput = [`Year ${year}:`];

    for (const season of ["Winter", "Spring", "Summer", "Fall"]) {
      const { WSPD_max, GST_max } = record[season];
      // If no valid data, these might remain -Infinity
      const wspdMaxVal =
        WSPD_max === Number.NEGATIVE_INFINITY ? null : WSPD_max;
      const gstMaxVal = GST_max === Number.NEGATIVE_INFINITY ? null : GST_max;

      // Accumulate to multi-year so we can average
      if (wspdMaxVal !== null) {
        multiYearAggregates[season].WSPD_maxSum += wspdMaxVal;
        multiYearAggregates[season].WSPD_count += 1;
      }
      if (gstMaxVal !== null) {
        multiYearAggregates[season].GST_maxSum += gstMaxVal;
        multiYearAggregates[season].GST_count += 1;
      }

      rowOutput.push(
        `${season} MAX: WSPD=${wspdMaxVal?.toFixed(2) ?? "N/A"}, GST=${
          gstMaxVal?.toFixed(2) ?? "N/A"
        }`
      );
    }

    console.log(rowOutput.join(" | "));
  });

  // Now compute the average of these maxima across all available years.
  console.log("\nMulti-year average of per-year maxima (2015–2024):");
  for (const season of ["Winter", "Spring", "Summer", "Fall"]) {
    const { WSPD_maxSum, WSPD_count, GST_maxSum, GST_count } =
      multiYearAggregates[season];

    const wspdAvgMax =
      WSPD_count > 0 ? (WSPD_maxSum / WSPD_count).toFixed(2) : "N/A";
    const gstAvgMax =
      GST_count > 0 ? (GST_maxSum / GST_count).toFixed(2) : "N/A";

    console.log(
      `${season}: WSPD avg of maxima = ${wspdAvgMax}, GST avg of maxima = ${gstAvgMax}`
    );
  }
}

main().catch((err) => {
  console.error("An error occurred:", err);
});
