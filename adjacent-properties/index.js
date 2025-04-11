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
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028582",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028574",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028566",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028558",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028531",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028523",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028515",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028329",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028337",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028361",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028388",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028396",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028418",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028426",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028434",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028442",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028450",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028469",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028477",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028620",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028612",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028604",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028590",
    },
    {
      "url":
        "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028647",
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
