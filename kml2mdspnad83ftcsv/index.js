const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const proj4 = require("proj4");

// Define projections
const fromProj = "EPSG:4326";
const toProj = "EPSG:2248"; // NAD83 / Maryland (ftUS)

function convertKmlToCsv(inputKml, outputCsv) {
  const parser = new xml2js.Parser();
  const xmlData = fs.readFileSync(inputKml, "utf8");

  parser.parseString(xmlData, (err, result) => {
    if (err) throw err;

    const placemarks = result.kml.Document[0].Placemark || [];
    const csvLines = ["Point,Northing,Easting,Elevation,Description"];

    placemarks.forEach((pm) => {
      const name = pm.name?.[0] || "Unknown";
      const coords = pm.Point?.[0]?.coordinates?.[0]?.trim().split(",") || [];
      if (coords.length >= 2) {
        const [longitude, latitude, elevation] = coords.map(Number);
        const [easting, northing] = proj4(fromProj, toProj, [
          longitude,
          latitude,
        ]);
        csvLines.push(
          `${name},${northing.toFixed(3)},${easting.toFixed(3)},${(
            elevation || 0
          ).toFixed(3)},-`
        );
      }
    });

    fs.writeFileSync(outputCsv, csvLines.join("\n"));
  });
}

// Usage
const inputPath = path.join(__dirname, "files", "input.kml");
const outputPath = path.join(__dirname, "files", "output.csv");
convertKmlToCsv(inputPath, outputPath);
