import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

function pdfString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function streamObject(bytes) {
  return Buffer.concat([
    Buffer.from("<< /Length " + String(bytes.length) + " >>\nstream\n", "ascii"),
    bytes,
    Buffer.from("\nendstream", "ascii"),
  ]);
}

const PASSWORD_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password) {
  const bytes = Buffer.from(password, "binary");
  return Buffer.concat([bytes, PASSWORD_PADDING]).subarray(0, 32);
}

function rc4(input, key) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let cursor = 0;
  for (let index = 0; index < 256; index += 1) {
    cursor = (cursor + state[index] + key[index % key.length]) & 0xff;
    [state[index], state[cursor]] = [state[cursor], state[index]];
  }
  const output = Buffer.alloc(input.length);
  let i = 0;
  let j = 0;
  for (let index = 0; index < input.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[index] = input[index] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
}

function encryptedKeys(userPassword) {
  const ownerPassword = "shelf-fixture-owner";
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const fileId = Buffer.from("5348454c464649585455524532303032", "hex");
  const ownerDigest = createHash("md5").update(padPassword(ownerPassword)).digest();
  const ownerKey = ownerDigest.subarray(0, 5);
  const ownerEntry = rc4(padPassword(userPassword), ownerKey);
  const fileKey = createHash("md5")
    .update(Buffer.concat([padPassword(userPassword), ownerEntry, permissions, fileId]))
    .digest()
    .subarray(0, 5);
  const userEntry = Buffer.concat([rc4(PASSWORD_PADDING, fileKey), Buffer.alloc(16)]);
  return { fileId, ownerEntry, userEntry, permissions, fileKey };
}

function objectKey(fileKey, objectId, generation = 0) {
  const suffix = Buffer.alloc(5);
  suffix[0] = objectId & 0xff;
  suffix[1] = (objectId >> 8) & 0xff;
  suffix[2] = (objectId >> 16) & 0xff;
  suffix[3] = generation & 0xff;
  suffix[4] = (generation >> 8) & 0xff;
  return createHash("md5")
    .update(Buffer.concat([fileKey, suffix]))
    .digest()
    .subarray(0, Math.min(16, fileKey.length + 5));
}

function makePdf(pages, options = {}) {
  const security = options.userPassword === undefined ? null : encryptedKeys(options.userPassword);
  const objects = [];
  const pageRefs = [];
  const fontId = 3;
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii");
  objects[fontId] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii");

  let nextId = 4;
  for (const page of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageRefs.push(String(pageId) + " 0 R");
    const commands = page.commands ?? [
      "BT /F1 18 Tf 48 " + String(page.height - 56) + " Td (" + pdfString(page.title ?? "Shelf PDF fixture") + ") Tj ET",
    ];
    let content = Buffer.from(commands.join("\n"), "ascii");
    if (security !== null) content = rc4(content, objectKey(security.fileKey, contentId));
    const imageRef = page.imageBytes === undefined ? "" : " /XObject << /Im1 " + String(nextId) + " 0 R >>";
    objects[pageId] = Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + String(page.width) + " " + String(page.height) + "]" +
      (page.rotate ? " /Rotate " + String(page.rotate) : "") +
      " /Resources << /Font << /F1 3 0 R >>" + imageRef + " >> /Contents " + String(contentId) + " 0 R >>",
      "ascii",
    );
    objects[contentId] = streamObject(content);

    if (page.imageBytes !== undefined) {
      const imageId = nextId++;
      const imageBytes = security === null
        ? page.imageBytes
        : rc4(page.imageBytes, objectKey(security.fileKey, imageId));
      objects[imageId] = Buffer.concat([
        Buffer.from(
          "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length " +
          String(imageBytes.length) + " >>\nstream\n",
          "ascii",
        ),
        imageBytes,
        Buffer.from("\nendstream", "ascii"),
      ]);
    }
  }

  objects[2] = Buffer.from(
    "<< /Type /Pages /Kids [" + pageRefs.join(" ") + "] /Count " + String(pages.length) + " >>",
    "ascii",
  );
  let encryptionId = null;
  if (security !== null) {
    encryptionId = nextId;
    objects[encryptionId] = Buffer.from(
      "<< /Filter /Standard /V 1 /R 2 /Length 40 /O <" + security.ownerEntry.toString("hex") +
      "> /U <" + security.userEntry.toString("hex") + "> /P -4 >>",
      "ascii",
    );
  }

  const parts = [Buffer.from("%PDF-1.7\n% Shelf redistributable synthetic fixture\n", "ascii")];
  const offsets = [0];
  let length = parts[0].length;
  for (let id = 1; id < objects.length; id++) {
    const object = objects[id];
    if (object === undefined) continue;
    offsets[id] = length;
    const wrapped = Buffer.concat([
      Buffer.from(String(id) + " 0 obj\n", "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    parts.push(wrapped);
    length += wrapped.length;
  }

  const xrefOffset = length;
  const xref = ["xref", "0 " + String(objects.length), "0000000000 65535 f "];
  for (let id = 1; id < objects.length; id++) {
    const offset = offsets[id] ?? 0;
    xref.push(String(offset).padStart(10, "0") + " 00000 n ");
  }
  parts.push(Buffer.from(
    xref.join("\n") + "\ntrailer\n<< /Size " + String(objects.length) +
    " /Root 1 0 R" +
    (security === null ? "" : " /Encrypt " + String(encryptionId) + " 0 R /ID [<" +
      security.fileId.toString("hex") + "><" + security.fileId.toString("hex") + ">]") +
    " >>\nstartxref\n" + String(xrefOffset) + "\n%%EOF\n",
    "ascii",
  ));
  return Buffer.concat(parts);
}

function textPage(title, width = 612, height = 792) {
  return {
    width,
    height,
    title,
    commands: [
      "BT /F1 18 Tf 48 " + String(height - 56) + " Td (" + pdfString(title) + ") Tj ET",
      "BT /F1 11 Tf 48 " + String(height - 92) + " Td (Shelf reader compatibility fixture.) Tj ET",
      "BT /F1 11 Tf 48 " + String(height - 112) + " Td (Searchable sample passage for end-to-end tests.) Tj ET",
    ],
  };
}

/** Generate reproducible, synthetic, redistributable PDF fixtures without external assets. */
export function createPdfFixtureCorpus() {
  const pixel = deflateSync(Buffer.from([0x42, 0x80, 0xc0]));
  const twoColumns = {
    width: 612,
    height: 792,
    title: "Two-column layout",
    commands: [
      "BT /F1 14 Tf 48 740 Td (LEFT COLUMN A) Tj ET",
      "BT /F1 11 Tf 48 710 Td (Left passage for order reconstruction.) Tj ET",
      "BT /F1 14 Tf 340 740 Td (RIGHT COLUMN A) Tj ET",
      "BT /F1 11 Tf 340 710 Td (Right passage for order reconstruction.) Tj ET",
    ],
  };
  const pagesLarge = Array.from({ length: 250 }, (_, index) => textPage(
    "Large document page " + String(index + 1),
    index % 2 === 0 ? 612 : 420,
    index % 2 === 0 ? 792 : 595,
  ));
  return new Map([
    ["mixed-page-sizes.pdf", makePdf([textPage("A4 portrait", 595, 842), textPage("Compact landscape", 792, 612)])],
    ["rotated-page.pdf", makePdf([{ ...textPage("Rotated page", 400, 600), rotate: 90 }])],
    ["two-columns.pdf", makePdf([twoColumns])],
    ["ligature-search.pdf", makePdf([{
      ...textPage("Ligature extraction fixture"),
      commands: [
        "BT /F1 18 Tf 48 740 Td (first office file) Tj ET",
        "BT /F1 11 Tf 48 710 Td (The words first and office exercise normalized search.) Tj ET",
      ],
    }])],
    ["large-250-pages.pdf", makePdf(pagesLarge)],
    ["image-only.pdf", makePdf([{
      width: 612,
      height: 792,
      title: "Image-only page",
      imageBytes: pixel,
      commands: ["q 400 0 0 400 100 180 cm /Im1 Do Q"],
    }])],
    ["password-protected.pdf", makePdf([textPage("Password fixture")], { userPassword: "shelf-test" })],
    ["malformed-truncated.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n", "ascii")],
  ]);
}

export function validateBasicPdfStructure(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false;
  if (bytes.subarray(0, 8).toString("ascii") !== "%PDF-1.7") return false;
  return bytes.toString("ascii").includes("startxref") && bytes.toString("ascii").includes("%%EOF");
}
