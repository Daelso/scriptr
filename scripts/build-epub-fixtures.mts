/**
 * Generates synthetic EPUB fixtures for tests in lib/epub/__fixtures__/.
 *
 * Three fixtures cover the test matrix:
 *  - sample-kdp.epub        : EPUB3, nav.xhtml, 1 chapter per spine item,
 *                              cover-image property, boilerplate front+back matter,
 *                              3 real chapters.
 *  - sample-smashwords.epub : EPUB2, toc.ncx, <meta name="cover"> pattern,
 *                              2 chapters.
 *  - sample-anchors.epub    : EPUB3, single XHTML in spine with 3 in-page
 *                              <h1 id="..."> anchors. Tests Pattern Z.
 *
 * NOTE: Vitest's test:watch does NOT rerun npm scripts. Re-run `npm run
 * build:fixtures` after editing this file to regenerate before watch picks up.
 */

import JSZip from "jszip";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "lib", "epub", "__fixtures__");

/** Escape XML special characters in user-supplied strings. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const MIMETYPE = "application/epub+zip";

const COVER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const COVER_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";

function chapterXhtml(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${esc(title)}</title></head>
<body><h1>${esc(title)}</h1>${body}</body>
</html>`;
}

async function writeEpub(zip: JSZip, outFile: string) {
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, buf);
  const rel = outFile.replace(`${process.cwd()}/`, "");
  console.log(`wrote ${rel} (${buf.byteLength} bytes)`);
}

async function buildKdp() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/cover.png", Buffer.from(COVER_PNG_BASE64, "base64"));

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-kdp</dc:identifier>
    <dc:title>The Garden Wall</dc:title>
    <dc:creator>Jane Author</dc:creator>
    <dc:description>A short synthetic EPUB3 for tests.</dc:description>
    <dc:subject>FIC027010</dc:subject>
    <dc:subject>romance</dc:subject>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="copyright" href="copyright.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="aboutauthor" href="aboutauthor.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="copyright"/>
    <itemref idref="title"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
    <itemref idref="aboutauthor"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="copyright.xhtml">Copyright</a></li>
      <li><a href="title.xhtml">Title Page</a></li>
      <li><a href="ch1.xhtml">Chapter 1: Arrival</a></li>
      <li><a href="ch2.xhtml">Chapter 2: The Door</a></li>
      <li><a href="ch3.xhtml">Chapter 3: Beyond</a></li>
      <li><a href="aboutauthor.xhtml">About the Author</a></li>
    </ol>
  </nav>
</body>
</html>`
  );

  zip.file(
    "OEBPS/copyright.xhtml",
    chapterXhtml("Copyright", ["Copyright 2026 Jane Author. All rights reserved."])
  );
  zip.file("OEBPS/title.xhtml", chapterXhtml("Title Page", ["The Garden Wall"]));
  zip.file(
    "OEBPS/ch1.xhtml",
    chapterXhtml("Chapter 1: Arrival", [
      "Mira stepped through the gate and into the garden for the first time.",
      "The air was warmer than she had expected.",
    ])
  );
  zip.file(
    "OEBPS/ch2.xhtml",
    chapterXhtml("Chapter 2: The Door", [
      "She found a door at the far end of the garden, half-hidden behind ivy.",
      "It was older than anything else she had seen here.",
    ])
  );
  zip.file(
    "OEBPS/ch3.xhtml",
    chapterXhtml("Chapter 3: Beyond", [
      "Beyond the door was another garden, and another, and another.",
      "She stopped counting after the seventh.",
    ])
  );
  zip.file(
    "OEBPS/aboutauthor.xhtml",
    chapterXhtml("About the Author", [
      "Jane Author lives somewhere quiet and writes about gardens.",
    ])
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-kdp.epub"));
}

async function buildSmashwords() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/cover.jpg", Buffer.from(COVER_JPEG_BASE64, "base64"));

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:fixture-sw</dc:identifier>
    <dc:title>Two Letters</dc:title>
    <dc:creator opf:role="aut">J. K. Author</dc:creator>
    <dc:description>An EPUB2 fixture using the toc.ncx pattern.</dc:description>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:fixture-sw"/></head>
  <docTitle><text>Two Letters</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>The First Letter</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
    <navPoint id="np2" playOrder="2">
      <navLabel><text>The Second Letter</text></navLabel>
      <content src="ch2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`
  );

  zip.file(
    "OEBPS/ch1.xhtml",
    chapterXhtml("The First Letter", ["Dear reader, this is the first letter.", "It is short on purpose."])
  );
  zip.file(
    "OEBPS/ch2.xhtml",
    chapterXhtml("The Second Letter", ["Dear reader, this is the second letter.", "Also short."])
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-smashwords.epub"));
}

async function buildAnchors() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/cover.png", Buffer.from(COVER_PNG_BASE64, "base64"));

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-anchors</dc:identifier>
    <dc:title>One File Three Chapters</dc:title>
    <dc:creator>Anchor Test</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="book" href="book.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="book"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="book.xhtml#ch1">Chapter One</a></li>
      <li><a href="book.xhtml#ch2">Chapter Two</a></li>
      <li><a href="book.xhtml#ch3">Chapter Three</a></li>
    </ol>
  </nav>
</body>
</html>`
  );

  zip.file(
    "OEBPS/book.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>One File Three Chapters</title></head>
<body>
  <h1 id="ch1">Chapter One</h1>
  <p>The first chapter is brief and to the point.</p>
  <p>It establishes the world.</p>
  <h1 id="ch2">Chapter Two</h1>
  <p>The second chapter introduces a complication.</p>
  <p>The complication is unexpected but inevitable.</p>
  <h1 id="ch3">Chapter Three</h1>
  <p>The third chapter resolves nothing.</p>
  <p>That is the point.</p>
</body>
</html>`
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-anchors.epub"));
}

async function buildNoNav() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-nonav</dc:identifier>
    <dc:title>No Nav Book</dc:title>
    <dc:creator>Spine Fallback</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/ch1.xhtml",
    chapterXhtml("Opening", ["The first chapter of a book without a nav.", "Walker should fall back to spine."])
  );
  zip.file(
    "OEBPS/ch2.xhtml",
    chapterXhtml("Closing", ["The second and final chapter.", "Title comes from the h1, not nav metadata."])
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-nonav.epub"));
}

async function main() {
  await buildKdp();
  await buildSmashwords();
  await buildAnchors();
  await buildNoNav();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
