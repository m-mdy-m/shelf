function makeStream(content) {
  const length = Buffer.byteLength(content, "binary");
  return `<< /Length ${length} >>\nstream\n${content}\nendstream`;
}

/** A compact three-page PDF with mixed page boxes, rotations, and Base-14 fonts. */
export function buildMixedPagePdfFixture() {
  const objects = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 0 /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>"],
    [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 540] /Rotate 90 /Resources << /Font << /F2 7 0 R >> >> /Contents 10 0 R >>"],
    [5, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 270 /Resources << /Font << /F3 8 0 R >> >> /Contents 11 0 R >>"],
    [6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
    [7, "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>"],
    [8, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"],
    [9, makeStream("BT /F1 12 Tf 72 720 Td (Portrait Helvetica page) Tj ET")],
    [10, makeStream("BT /F2 14 Tf 36 500 Td (Rotated Times page) Tj ET")],
    [11, makeStream("BT /F3 10 Tf 40 800 Td (Landscape Courier page) Tj ET")],
  ];

  let pdf = "%PDF-1.7\n";
  const offsets = new Array(objects.length + 1).fill(0);
  for (const [id, body] of objects) {
    offsets[id] = Buffer.byteLength(pdf, "binary");
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** A deliberately malformed PDF header/body pair for failure mapping tests. */
export function buildMalformedPdfFixture() {
  return new TextEncoder().encode("%PDF-1.7\nthis is not a PDF object or cross-reference table\n%%EOF\n");
}
