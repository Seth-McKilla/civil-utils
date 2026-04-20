const fs = require("fs");
const path = require("path");

// Dynamic import for node-fetch v3 in CommonJS
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

async function extractFromUrl(url) {
  const res = await fetch(url);
  const html = await res.text();

  const ownerNames = [];
  const ownerRegex = /id="[^"]*lblOwnerName(?:2)?_0"[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = ownerRegex.exec(html)) !== null) {
    ownerNames.push(match[1].trim());
  }
  const owner = ownerNames.join(", ") || "Not found";

  let mailingAddress = "Not found";
  const addrMatch = html.match(
    /id="[^"]*lblMailingAddress_0"[^>]*>([\s\S]*?)<\/span>/
  );
  if (addrMatch) {
    mailingAddress = addrMatch[1]
      .replace(/<br\s*\/?>/gi, ", ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { owner, mailingAddress };
}

(async () => {
  // Array of objects; each object has a "url" property.
  const urlObjects = [
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=003631",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=041193",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=041223",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=041274",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=041266",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=018590",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031082",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031090",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031112",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031120",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031139",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031147",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=19&SearchType=ACCT&District=01&AccountNumber=031155",
    },
  ];

  let results = "";

  for (const obj of urlObjects) {
    const url = obj.url;
    console.log(`Processing: ${url}`);
    try {
      const { owner, mailingAddress } = await extractFromUrl(url);
      const output = `Owner: ${owner}\nMailing Address: ${mailingAddress}\n\n---\n\n`;
      results += output;
      console.log(output);
    } catch (error) {
      console.error(`Error processing ${url}:`, error.message);
    }
  }

  // Ensure the 'output' folder exists in the same directory as this script.
  const outputDir = path.join(__dirname, "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write results to output/results.txt without including the URL.
  fs.writeFileSync(path.join(outputDir, "adjacent-properties.txt"), results);
  console.log(
    `Results saved to ${path.join(outputDir, "adjacent-properties.txt")}`
  );
})();
