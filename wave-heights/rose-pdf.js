/**
 * Writes a one-page wave/fetch rose PDF plus a results table page.
 * Page 1: two compass roses side by side (separate scales, no dual axis):
 *   - Left:  projected Hmo (ft) for each wind direction (wind blowing FROM that bearing)
 *   - Right: measured radial fetch length (mi) for each direction
 * Page 2: full results table.
 */

const fs = require("fs");
const PDFDocument = require("pdfkit");

const INK = "#0b0b0b";
const INK_2 = "#52514e";
const GRID = "#d6d5d0";
// Sequential blue ramp (light -> dark) for wave height magnitude
const BLUES = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];
const FETCH_FILL = "#a3a19a";
const FT_PER_MI = 5280;

const rad = (deg) => (deg * Math.PI) / 180;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (BLUES.length - 1);
  const i = Math.min(Math.floor(x), BLUES.length - 2);
  const f = x - i;
  const a = hexToRgb(BLUES[i]);
  const b = hexToRgb(BLUES[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}

/** "Nice" ring step: 4-6 rings, picking the one whose outer ring is closest above max. */
function niceStep(max) {
  let best = null;
  for (let rings = 4; rings <= 6; rings++) {
    const raw = max / rings;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(max / step) * step;
    if (!best || top < best.top) best = { step, top };
  }
  return best.step;
}

/** Compass bearing (0 = N, clockwise) -> page coordinates. */
const pt = (cx, cy, r, bearing) => [cx + r * Math.sin(rad(bearing)), cy - r * Math.cos(rad(bearing))];

function drawWedge(doc, cx, cy, r, bearing, halfWidth, color, outline = false) {
  if (r <= 0) return;
  const steps = 6;
  doc.moveTo(cx, cy);
  for (let s = 0; s <= steps; s++) {
    const [x, y] = pt(cx, cy, r, bearing - halfWidth + (2 * halfWidth * s) / steps);
    doc.lineTo(x, y);
  }
  if (outline) doc.closePath().lineWidth(1.4).fillColor(color).strokeColor(INK).fillAndStroke();
  else doc.closePath().fillColor(color).fill();
}

/** Draw rings, spokes and compass labels; returns the value->radius scale. */
function drawRoseFrame(doc, cx, cy, R, maxVal, unitLabel, decimals) {
  const step = niceStep(maxVal);
  const top = Math.ceil(maxVal / step) * step || step;
  const scale = (v) => (v / top) * R;

  doc.lineWidth(0.5).strokeColor(GRID);
  for (let v = step; v <= top + 1e-9; v += step) doc.circle(cx, cy, scale(v)).stroke();
  for (let b = 0; b < 360; b += 30) {
    const [x, y] = pt(cx, cy, R, b);
    doc.moveTo(cx, cy).lineTo(x, y).stroke();
  }

  // compass labels
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  const labels = { 0: "N", 90: "E", 180: "S", 270: "W" };
  for (let b = 0; b < 360; b += 30) {
    const [x, y] = pt(cx, cy, R + 13, b);
    const text = labels[b] || `${b}°`;
    doc.font(labels[b] ? "Helvetica-Bold" : "Helvetica").fontSize(labels[b] ? 10 : 7.5).fillColor(labels[b] ? INK : INK_2);
    const w = doc.widthOfString(text);
    doc.text(text, x - w / 2, y - 4, { lineBreak: false });
  }
  return { scale, step, top, ringLabels: (bearing = 15) => drawRingLabels(doc, cx, cy, scale, step, top, unitLabel, decimals, bearing) };
}

/** Ring labels drawn last so they sit on top of the wedges. */
function drawRingLabels(doc, cx, cy, scale, step, top, unitLabel, decimals, bearing = 15) {
  doc.font("Helvetica").fontSize(6.5);
  for (let v = step; v <= top + 1e-9; v += step) {
    const text = `${v.toFixed(decimals)}${v + step > top + 1e-9 ? " " + unitLabel : ""}`;
    const [x, y] = pt(cx, cy, scale(v), bearing);
    const w = doc.widthOfString(text);
    doc.rect(x + 1, y - 4.5, w + 3, 8).fillColor("#ffffff").fillOpacity(0.85).fill().fillOpacity(1);
    doc.fillColor(INK_2).text(text, x + 2.5, y - 3.5, { lineBreak: false });
  }
}

function writeRosePdf(outPath, { rows, radialsFt, fetchFile, windFile, windDesc, settings }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);

    const W = doc.page.width;
    const H = rows.map((r) => parseFloat(r.hFt));
    const maxH = Math.max(...H);
    const maxRow = rows[H.indexOf(maxH)];

    // Header
    doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text("Projected Wind Waves on Restricted Fetch", 36, 32);
    doc.font("Helvetica").fontSize(8.5).fillColor(INK_2)
      .text(`Smith (1991), USACE CERC-91-2 restricted-fetch method   |   Wind: ${windFile}   |   Fetch: ${fetchFile}`, 36, 52)
      .text(settings, 36, 64);
    doc.font("Helvetica-Bold").fillColor(INK).text(windDesc, 36, 76);

    const cy = 318;
    const R = 150;
    const cxL = W * 0.255;
    const cxR = W * 0.745;

    // --- Left rose: Hmo by wind direction ---
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Significant wave height Hmo (ft) by wind direction", cxL - R - 10, 104, { width: 2 * R + 20, align: "center" });
    const left = drawRoseFrame(doc, cxL, cy, R, maxH, "ft", 1);
    for (const r of rows) {
      const h = parseFloat(r.hFt);
      const c = rampColor(h / maxH);
      drawWedge(doc, cxL, cy, left.scale(h), r.dir, 2.1, c);
    }
    // Dominant (max Hmo) direction in each compass quadrant: outline + label
    const QUADS = [[0, 90], [90, 180], [180, 270], [270, 360]];
    const quadMax = QUADS.map(([a, b]) =>
      rows.filter((r) => r.dir >= a && r.dir < b).reduce((m, r) => (!m || parseFloat(r.hFt) > parseFloat(m.hFt) ? r : m), null)
    ).filter(Boolean);
    const quietest = quadMax.reduce((m, r) => (parseFloat(r.hFt) < parseFloat(m.hFt) ? r : m));
    left.ringLabels(Math.floor(quietest.dir / 90) * 90 + 45);

    for (const r of quadMax) {
      const h = parseFloat(r.hFt);
      drawWedge(doc, cxL, cy, left.scale(h), r.dir, 2.1, rampColor(h / maxH), true);
    }
    doc.font("Helvetica-Bold").fontSize(7.5);
    for (const r of quadMax) {
      const text = `${r.dir}°: ${parseFloat(r.hFt).toFixed(1)} ft`;
      const w = doc.widthOfString(text);
      // outside the tip, or tucked inside it if the tip is near the rim
      const rTip = left.scale(parseFloat(r.hFt));
      const inward = rTip > R * 0.75;
      const [x, y] = pt(cxL, cy, inward ? rTip - 6 : rTip + 6, r.dir);
      const sgn = inward ? -1 : 1;
      const s = Math.sin(rad(r.dir)) * sgn;
      const tx = s > 0.2 ? x : s < -0.2 ? x - w - 4 : x - w / 2 - 2;
      const c = Math.cos(rad(r.dir)) * sgn;
      const ty = c > 0.2 ? y - 10 : c < -0.2 ? y : y - 5;
      doc.rect(tx, ty, w + 4, 10).fillColor("#ffffff").fill();
      doc.lineWidth(0.6).strokeColor(INK).rect(tx, ty, w + 4, 10).stroke();
      doc.fillColor(INK).text(text, tx + 2, ty + 2, { lineBreak: false });
    }

    // --- Right rose: measured fetch ---
    const fetchMi = radialsFt.map((f) => ({ dir: f.dir, mi: f.ft / FT_PER_MI }));
    const maxF = Math.max(...fetchMi.map((f) => f.mi));
    const dirs = fetchMi.map((f) => f.dir).sort((a, b) => a - b);
    let spacing = 360;
    for (let i = 1; i < dirs.length; i++) spacing = Math.min(spacing, dirs[i] - dirs[i - 1]);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Measured fetch length (mi) by direction", cxR - R - 10, 104, { width: 2 * R + 20, align: "center" });
    const right = drawRoseFrame(doc, cxR, cy, R, maxF, "mi", maxF < 4 ? 1 : 0);
    for (const f of fetchMi) drawWedge(doc, cxR, cy, right.scale(f.mi), f.dir, spacing * 0.42, FETCH_FILL);
    right.ringLabels();

    // Legend for Hmo color ramp
    const lx = cxL - 90;
    const ly = 520;
    for (let i = 0; i < 100; i++) {
      doc.rect(lx + i * 1.8, ly, 1.9, 8).fillColor(rampColor(i / 99)).fill();
    }
    doc.font("Helvetica").fontSize(7.5).fillColor(INK_2)
      .text("0 ft", lx - 18, ly + 1, { lineBreak: false })
      .text(`${maxH.toFixed(1)} ft`, lx + 184, ly + 1, { lineBreak: false });

    // Callouts
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
      .text(`Max Hmo = ${maxH.toFixed(1)} ft (Tp ${maxRow.tp} s) for wind from ${maxRow.dir}°`, cxL - R, 536, { width: 2 * R, align: "center" });
    const maxFetch = fetchMi.reduce((a, b) => (b.mi > a.mi ? b : a));
    doc.text(`Longest fetch = ${maxFetch.mi.toFixed(2)} mi (${Math.round(maxFetch.mi * FT_PER_MI).toLocaleString()} ft) at ${maxFetch.dir}°`, cxR - R, 536, { width: 2 * R, align: "center" });

    doc.font("Helvetica").fontSize(7).fillColor(INK_2).text(
      "Bearings are degrees clockwise from north. Wave rose wedges point toward the direction the wind blows FROM; fetch wedges point along the measured radial from the site. " +
        "Outlined, labeled wedges mark the dominant (largest Hmo) wind direction in each quadrant (N-E, E-S, S-W, W-N); those rows are bold in the table. Hmo uses the 15°-averaged fetch in the Smith wave direction (see table). Duration limits not checked; results are fetch-limited or capped at fully developed.",
      36, 550, { width: W - 72, lineGap: 0.5 }
    );

    // --- Page 2: table ---
    doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("Results table", 36, 32);
    const cols = [
      ["Wind dir (°)", (r) => r.dir],
      ["U (m/s)", (r) => r.u],
      ["UA (m/s)", (r) => r.ua],
      ["Wave dir (°)", (r) => r.waveDir],
      ["phi (°)", (r) => r.phi],
      ["Eff. fetch (ft)", (r) => Number(r.fetchFt).toLocaleString()],
      ["Hmo (ft)", (r) => r.hFt],
      ["Tp (s)", (r) => r.tp],
    ];
    const colW = 41;
    const half = Math.ceil(rows.length / 2);
    [rows.slice(0, half), rows.slice(half)].forEach((chunk, ci) => {
      const x0 = 36 + ci * (cols.length * colW + 28);
      let y = 56;
      doc.font("Helvetica-Bold").fontSize(7).fillColor(INK);
      cols.forEach(([h], i) => doc.text(h, x0 + i * colW, y, { width: colW - 3, align: "right" }));
      y += 20;
      doc.moveTo(x0, y - 4).lineTo(x0 + cols.length * colW, y - 4).lineWidth(0.5).strokeColor(GRID).stroke();
      doc.font("Helvetica").fontSize(7);
      for (const r of chunk) {
        const isMax = quadMax.includes(r);
        doc.font(isMax ? "Helvetica-Bold" : "Helvetica").fillColor(INK);
        cols.forEach(([, f], i) => doc.text(String(f(r)), x0 + i * colW, y, { width: colW - 3, align: "right", lineBreak: false }));
        y += 13.4;
      }
    });

    doc.end();
  });
}

module.exports = { writeRosePdf };
