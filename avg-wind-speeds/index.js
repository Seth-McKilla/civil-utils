const https = require("https");
const zlib = require("zlib");

// Define meteorological seasons.
function getSeason(month) {
  // month is 1-based (Jan=1 ... Dec=12)
  if ([12, 1, 2].includes(month)) return "Winter";
  if ([3, 4, 5].includes(month)) return "Spring";
  if ([6, 7, 8].includes(month)) return "Summer";
  if ([9, 10, 11].includes(month)) return "Fall";
  return "Unknown";
}

// Helper to track sums and counts for computing averages later.
function initSeasonRecord() {
  return {
    WSPD_sum: 0,
    WSPD_count: 0,
    GST_sum: 0,
    GST_count: 0,
  };
}

// Download and parse one year of data.
function fetchAndProcessYear(year, seasonalData) {
  return new Promise((resolve, reject) => {
    const url = `https://www.ndbc.noaa.gov/view_text_file.php?filename=ncdv2h${year}.txt.gz&dir=data/historical/stdmet/`;
    https
      .get(url, (res) => {
        // Pipe through gunzip
        const gunzip = zlib.createGunzip();
        res.pipe(gunzip);

        let buffer = "";

        gunzip.on("data", (chunk) => {
          buffer += chunk.toString();
        });

        gunzip.on("end", () => {
          // Process the file line by line
          const lines = buffer.split("\n");
          for (const line of lines) {
            // Skip header or comment lines starting with '#'
            if (!line || line.startsWith("#")) {
              continue;
            }

            // Columns: #YY  MM DD hh mm WDIR WSPD GST  ...
            // Split on whitespace, ignoring multiple spaces
            const columns = line.trim().split(/\s+/);
            if (columns.length < 8) {
              continue; // Not enough columns
            }

            const fileYear = parseInt(columns[0], 10);
            const month = parseInt(columns[1], 10);
            const day = parseInt(columns[2], 10);
            // WSPD is column index 6, GST is index 7
            const wspd = parseFloat(columns[6]);
            const gst = parseFloat(columns[7]);

            // Basic filter for suspicious or missing data:
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
            // Ensure structure is present for the [year][season]
            if (!seasonalData[year]) {
              seasonalData[year] = {
                Winter: initSeasonRecord(),
                Spring: initSeasonRecord(),
                Summer: initSeasonRecord(),
                Fall: initSeasonRecord(),
              };
            }

            const record = seasonalData[year][season];
            record.WSPD_sum += wspd;
            record.WSPD_count += 1;
            record.GST_sum += gst;
            record.GST_count += 1;
          }
          resolve();
        });

        gunzip.on("error", (err) => reject(err));
      })
      .on("error", (err) => reject(err));
  });
}

async function main() {
  // Data structure:
  // {
  //   [yearNumber]: {
  //     Winter: { WSPD_sum, WSPD_count, GST_sum, GST_count },
  //     Spring: { ... },
  //     Summer: { ... },
  //     Fall:   { ... }
  //   }
  // }
  const seasonalData = {};

  // Loop over each year, download, and process.
  for (let year = 2015; year <= 2024; year++) {
    console.log(`Fetching data for year: ${year}`);
    await fetchAndProcessYear(year, seasonalData);
  }

  // Compute averages per season, per year.
  // Also track sums across years for an overall multi-year average.
  const multiYearTotals = {
    Winter: initSeasonRecord(),
    Spring: initSeasonRecord(),
    Summer: initSeasonRecord(),
    Fall: initSeasonRecord(),
  };
  let validSeasonCount = {
    Winter: 0,
    Spring: 0,
    Summer: 0,
    Fall: 0,
  };

  console.log("\nPer-year seasonal averages (WSPD, GST):");
  for (const y of Object.keys(seasonalData).sort()) {
    const year = parseInt(y, 10);
    const record = seasonalData[year];
    const rowOutput = [`Year ${year}:`];

    for (const season of ["Winter", "Spring", "Summer", "Fall"]) {
      const { WSPD_sum, WSPD_count, GST_sum, GST_count } = record[season];

      let wspdAvg = null;
      let gstAvg = null;
      if (WSPD_count > 0) {
        wspdAvg = WSPD_sum / WSPD_count;
      }
      if (GST_count > 0) {
        gstAvg = GST_sum / GST_count;
      }

      // Update multi-year totals if we got a valid average
      if (wspdAvg !== null && gstAvg !== null) {
        multiYearTotals[season].WSPD_sum += WSPD_sum;
        multiYearTotals[season].WSPD_count += WSPD_count;
        multiYearTotals[season].GST_sum += GST_sum;
        multiYearTotals[season].GST_count += GST_count;
        validSeasonCount[season] += 1;
      }

      rowOutput.push(
        `${season}: WSPD=${wspdAvg ? wspdAvg.toFixed(2) : "N/A"}, ` +
          `GST=${gstAvg ? gstAvg.toFixed(2) : "N/A"}`
      );
    }
    console.log(rowOutput.join("  |  "));
  }

  console.log("\nMulti-year seasonal averages (2015–2024):");
  for (const season of ["Winter", "Spring", "Summer", "Fall"]) {
    const { WSPD_sum, WSPD_count, GST_sum, GST_count } =
      multiYearTotals[season];
    const wspdAvg = WSPD_count > 0 ? (WSPD_sum / WSPD_count).toFixed(2) : "N/A";
    const gstAvg = GST_count > 0 ? (GST_sum / GST_count).toFixed(2) : "N/A";
    console.log(`${season}: WSPD=${wspdAvg}, GST=${gstAvg}`);
  }
}

main().catch((err) => {
  console.error("An error occurred:", err);
});
