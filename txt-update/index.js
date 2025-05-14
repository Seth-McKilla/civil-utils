const fs = require("fs");
const path = require("path");

const desc = process.argv[2];
if (!desc) {
  console.error("Usage: node index.js <description>");
  process.exit(1);
}

const filePath = path.join(__dirname, "files", "input.txt");
const data = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);

const filtered = data.filter((line) => {
  const [pointNo, northing, easting, elevation, description] = line.split(",");
  return description === desc;
});

const renumbered = filtered.map((line, i) => {
  const cols = line.split(",");
  cols[0] = i + 1;
  return cols.join(",");
});

fs.writeFileSync(filePath, renumbered.join("\n"));
