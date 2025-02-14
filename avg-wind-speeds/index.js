const https = require("https");
const zlib = require("zlib");

// Determine meteorological season from month.
function getSeason(month) {
  if ([12, 1, 2].includes(month)) return "Winter";
  if ([3, 4, 5].includes(month)) return "Spring";
  if ([6, 7, 8].includes(month)) return "Summer";
  if ([9, 10, 11].includes(month)) return "Fall";
  return "Unknown";
}

// Initialize sum/count records for a season’s wind speed and gust.
function initSeasonRecord() {
  return {
    WSPD_sum: 0,
    WSPD_count: 0,
    GST_sum: 0,
    GST_count: 0,
  };
}

// Parse raw file text (once fully read/decompressed) into seasonalData object.
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
    // Skip headers or empty lines
    if (!line || line.startsWith("#")) continue;

    // Split on whitespace
    const columns = line.trim().split(/\s+/);
    // We expect columns: YY, MM, DD, hh, mm, WDIR, WSPD, GST, ...
    if (columns.length < 8) {
      continue;
    }

    const fileYear = parseInt(columns[0], 10);
    const month = parseInt(columns[1], 10);
    // const day = parseInt(columns[2], 10); // day if needed
    const wspd = parseFloat(columns[6]);
    const gst = parseFloat(columns[7]);

    // Filter out missing/suspicious data (e.g., 99.00 or bigger outliers).
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
    record.WSPD_sum += wspd;
    record.WSPD_count += 1;
    record.GST_sum += gst;
    record.GST_count += 1;
  }
}

// Download + process data for a single year.
function fetchAndProcessYear(year, seasonalData) {
  return new Promise((resolve, reject) => {
    const url = `https://www.ndbc.noaa.gov/view_text_file.php?filename=ncdv2h${year}.txt.gz&dir=data/historical/stdmet/`;
    https
      .get(url, (res) => {
        // Check for HTTP success
        if (res.statusCode !== 200) {
          console.warn(`Year ${year}: status code ${res.statusCode}, skipping`);
          res.resume();
          return resolve(); // Not throwing an error; just skip
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);

          // GZIP signature check (0x1f, 0x8b)
          if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
            // It's gzipped
            zlib.gunzip(body, (err, decompressed) => {
              if (err) return reject(err);
              parseFileAsText(decompressed.toString(), year, seasonalData);
              resolve();
            });
          } else {
            // Probably plain text (or an error page).
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
  // Data structure: { [year]: { Winter: {...}, Spring: {...}, Summer: {...}, Fall: {...} } }
  const seasonalData = {};

  // Fetch each year from 2015–2024
  for (let year = 2015; year <= 2024; year++) {
    console.log(`Fetching data for year: ${year}`);
    await fetchAndProcessYear(year, seasonalData);
  }

  // Compute and display per-year seasonal averages, plus multi-year seasonal averages.
  const multiYearTotals = {
    Winter: initSeasonRecord(),
    Spring: initSeasonRecord(),
    Summer: initSeasonRecord(),
    Fall: initSeasonRecord(),
  };

  console.log("\nPer-year seasonal averages (WSPD, GST):");
  Object.keys(seasonalData)
    .sort()
    .forEach((y) => {
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

        // Accumulate into multi-year totals if valid
        if (wspdAvg !== null && gstAvg !== null) {
          multiYearTotals[season].WSPD_sum += WSPD_sum;
          multiYearTotals[season].WSPD_count += WSPD_count;
          multiYearTotals[season].GST_sum += GST_sum;
          multiYearTotals[season].GST_count += GST_count;
        }

        rowOutput.push(
          `${season}: WSPD=${wspdAvg?.toFixed(2) ?? "N/A"}, GST=${
            gstAvg?.toFixed(2) ?? "N/A"
          }`
        );
      }
      console.log(rowOutput.join(" | "));
    });

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
