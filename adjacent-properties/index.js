/**
 * scrape.js
 *
 * A Puppeteer script to scrape Owner Name and Mailing Address
 * from Maryland SDAT property pages.
 */

const puppeteer = require("puppeteer");
const fs = require("fs");

/**
 * 1) Put all your property-detail URLs here.
 *    Example only includes one URL, but you can add more in this array.
 */
const propertyUrls = [
  "https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=18&SearchType=ACCT&District=05&AccountNumber=028647",
];

/**
 * 2) A helper to safely query text from a selector (or return empty string).
 */
async function getText(page, selector) {
  const el = await page.$(selector);
  if (!el) return "";
  return page.evaluate((element) => element.innerText.trim(), el);
}

(async () => {
  // 3) Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: true, // or set to false if you want to see the browser
  });

  // 4) Open a new page
  const page = await browser.newPage();

  // 5) Prepare a write stream (append mode) for results.txt
  const fileStream = fs.createWriteStream("results.txt", { flags: "a" });

  for (const url of propertyUrls) {
    console.log(`Scraping: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });

    // 6) Extract the relevant text using known selectors
    //    The example site often has a table or div with ID-based selectors,
    //    e.g. #ctl00_ContentPlaceHolderMain_dvBasicInformation for general info
    //    and #ctl00_ContentPlaceHolderMain_dvMailingAddress for the address.
    //    The exact layout may differ by county, but this is a good starting guess.

    const ownerNameSel =
      "#ctl00_ContentPlaceHolderMain_dvBasicInformation tr:nth-child(2) td:nth-child(2)";
    const mailingAddrSel = "#ctl00_ContentPlaceHolderMain_dvMailingAddress";

    const ownerName = await getText(page, ownerNameSel);
    const mailingAddr = await getText(page, mailingAddrSel);

    // 7) Format how you want the text to appear
    const output = `URL: ${url}\nOwner Name: ${ownerName}\nMailing Address:\n${mailingAddr}\n\n----\n\n`;

    // 8) Write to results.txt
    fileStream.write(output);

    // 9) Show feedback in console
    console.log(`Scraped:\n${output}`);
  }

  fileStream.end();
  await browser.close();
  console.log("Done! Check results.txt for the output.");
})();
