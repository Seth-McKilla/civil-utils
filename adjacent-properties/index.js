const fs = require("fs");

// Use dynamic import workaround for node-fetch v3 in CommonJS
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

async function extractFromUrl(url) {
  const res = await fetch(url);
  const html = await res.text();

  // Extract owner names from spans with IDs ending in lblOwnerName_0 or lblOwnerName2_0
  const ownerNames = [];
  const ownerRegex = /id="[^"]*lblOwnerName(?:2)?_0"[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = ownerRegex.exec(html)) !== null) {
    ownerNames.push(match[1].trim());
  }
  const owner = ownerNames.join(", ") || "Not found";

  // Extract mailing address from the span with ID ending in lblMailingAddress_0
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
  // Add as many SDAT page URLs as needed in this array.
  const urls = [
    "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028647",
    // 'https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=xx&SearchType=ACCT&District=xx&AccountNumber=xxxxxx',
  ];

  let results = "";

  for (const url of urls) {
    console.log(`Processing: ${url}`);
    try {
      const { owner, mailingAddress } = await extractFromUrl(url);
      const output = `URL: ${url}\nOwner: ${owner}\nMailing Address: ${mailingAddress}\n---\n\n`;
      results += output;
      console.log(output);
    } catch (error) {
      console.error(`Error processing ${url}:`, error.message);
    }
  }

  fs.writeFileSync("results.txt", results);
  console.log("Results saved to results.txt");
})();
