const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const proj4 = require("proj4");
// Define Maryland State Plane coords
proj4.defs(
  "EPSG:2248",
  "+proj=lcc +lat_1=38.3 +lat_2=39.45 +lat_0=37.66666666666666 " +
    "+lon_0=-77 +x_0=400000.0 +y_0=0 +ellps=GRS80 " +
    "+towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs"
);
// Define projections
const wgs84 = "EPSG:4326";
const nad83MD = "EPSG:2248";

function convertKmlToCsv(inputKml, outputCsv) {
  const parser = new xml2js.Parser();
  const xmlData = fs.readFileSync(inputKml, "utf8");

  parser.parseString(xmlData, (err, result) => {
    if (err) throw err;

    let pointNumber = 0;
    const placemarks = result.kml.Document[0].Folder[0].Placemark || [];
    const csvLines = ["Point,Northing,Easting,Elevation,Description"];

    placemarks.forEach((pm) => {
      pointNumber++;
      const name = pm.name?.[0] || "Unknown";
      const coords = pm.Point?.[0]?.coordinates?.[0]?.trim().split(",") || [];
      if (coords.length >= 2) {
        const [longitude, latitude, elevation] = coords.map(Number);
        const [easting, northing] = proj4(wgs84, nad83MD, [
          longitude,
          latitude,
        ]);
        csvLines.push(
          `${pointNumber},${northing.toFixed(4)},${easting.toFixed(4)},${(
            elevation || 0
          ).toFixed(2)},${name}`
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
