// Generates a synthetic NovelAI .story file for tests. Mirrors the CRDT
// document shape observed in real NovelAI exports (storyContainerVersion=1):
//
//   outer JSON:
//     { storyContainerVersion: 1, metadata: {...}, content: {...} }
//
//   content.document is base64(msgpack(streamed-objects)). Real files emit
//   a few opaque ext markers followed by Map objects whose keys include a
//   mix of floats (section ids), strings (long prose also appears as keys),
//   and numbers (keyTable indices). The decoder walks the whole tree and
//   harvests long strings; it does NOT require a specific schema.
//
// This fixture emits the simplest possible doc that still exercises:
//   - `Map` with integer keys (so the decoder's Map-handling path runs)
//   - A prose string long enough to be harvested (two, actually)
//   - A short "premise" string that matches metadata.description — the
//     decoder must filter it out via its premise/context/lorebook filter.
//
// Run: node lib/novelai/__fixtures__/build-sample.mjs
// Output: lib/novelai/__fixtures__/sample.story
//
// NOTE: prose below is synthetic placeholder content. DO NOT replace it
// with real NovelAI session output.

import { encode as msgpackEncode } from "@msgpack/msgpack";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = dirname(fileURLToPath(import.meta.url));

// --- Synthetic prose (source=2 equivalent) --------------------------------
// Both chapters are stored as one long CRDT segment with //// between them.
// The marker must survive the MIN_PROSE_LEN filter, so it lives inside the
// long string rather than as a standalone 4-char segment.
const proseFull =
  "The garden at dusk had a color no camera could catch — a green that thought of itself as silver, leaves hushed against the old stone wall.\n\n" +
  "She set her mug down on the iron bench and exhaled. For the first time in days she could hear herself think.\n\n" +
  "////\n\n" +
  "Chapter 2: Morning\n\n" +
  "Light came through the curtains the color of weak tea. He'd forgotten to pull them all the way closed last night and now the whole room felt rinsed.\n\n" +
  "She was already up. He could hear the kettle from the kitchen.";

// Short premise that duplicates metadata.description — decoder must filter
const premiseEcho = "A short two-chapter synthetic fixture for tests.";

// --- Build the msgpack op-log ---------------------------------------------
// Shape: [fixext marker, fixext marker, Map{ float-id -> prose-text, ... },
//         Map{ int-key -> prose-text }, Map{ key-table }]
// The exact structure doesn't matter — only that the decoder's tree-walk
// finds long strings inside it.

// fixext 1: byte 0xd4, then 1-byte type code, then 1-byte data
function fixext1(code, byteVal) {
  return new Uint8Array([0xd4, code & 0xff, byteVal & 0xff]);
}

const extA = fixext1(20, 0x00); // observed in real files
const extB = fixext1(114, 0x40); // observed in real files

// Map with float keys (section ids) → prose. msgpack Map encoding.
// Note: @msgpack/msgpack doesn't properly encode JS Maps, so we use objects.
const sectionsA = {
  [1497243114306281.0]: proseFull,
  [1497243114306282.0]: premiseEcho, // this one should be filtered
};

// Map with integer keys → short/ignored segments (simulates continuation ops)
const sectionsB = {
  1: "short bit", // below MIN_PROSE_LEN — should be ignored
};

// Key table (an array of strings, as seen in real files)
const keyTable = ["type", "text", "meta", "source"];

const extAEnc = extA;
const extBEnc = extB;
const sectionsAEnc = msgpackEncode(sectionsA);
const sectionsBEnc = msgpackEncode(sectionsB);
const keyTableEnc = msgpackEncode(keyTable);

const totalLen =
  extAEnc.length +
  extBEnc.length +
  sectionsAEnc.length +
  sectionsBEnc.length +
  keyTableEnc.length;
const streamBytes = new Uint8Array(totalLen);
{
  let off = 0;
  streamBytes.set(extAEnc, off); off += extAEnc.length;
  streamBytes.set(extBEnc, off); off += extBEnc.length;
  streamBytes.set(sectionsAEnc, off); off += sectionsAEnc.length;
  streamBytes.set(sectionsBEnc, off); off += sectionsBEnc.length;
  streamBytes.set(keyTableEnc, off);
}

const documentB64 = Buffer.from(streamBytes).toString("base64");

// --- Outer envelope --------------------------------------------------------
const envelope = {
  storyContainerVersion: 1,
  metadata: {
    storyMetadataVersion: 1,
    id: "fixture-0000-0000-0000-000000000001",
    title: "Garden at Dusk",
    description: "A short two-chapter synthetic fixture for tests.",
    textPreview: "The garden at dusk had a color no camera could catch",
    isTA: false,
    favorite: false,
    tags: ["fixture", "test"],
    createdAt: 0,
    lastUpdatedAt: 0,
    isModified: false,
    hasDocument: true,
  },
  content: {
    storyContentVersion: 1,
    settings: {},
    document: documentB64,
    context: [
      { text: "Mira: mid-30s, quiet, notices small things. Narrator POV." },
      { text: "Style: spare, image-forward, no melodrama." },
    ],
    lorebook: {
      lorebookVersion: 5,
      entries: [
        {
          displayName: "Mira",
          text: "Mira is a gardener in her mid-30s. She keeps a small herb patch and a collection of old tea mugs.",
          keys: ["Mira"],
          category: "character",
        },
        {
          displayName: "The Walled Garden",
          text: "An old walled garden, south-facing, overgrown in places. A stone bench sits near the east wall.",
          keys: ["garden", "walled garden"],
          category: "location",
        },
      ],
      settings: { orderByKeyLocations: false },
      categories: [],
      order: [],
    },
    storyContextConfig: {},
    ephemeralContext: [],
    contextDefaults: {},
    settingsDirty: false,
    didGenerate: true,
    phraseBiasGroups: [],
    bannedSequenceGroups: [],
    messageSettings: {},
    sideChats: [],
    userScripts: [],
    scriptStorage: {},
  },
};

writeFileSync(join(outDir, "sample.story"), JSON.stringify(envelope, null, 2));
console.log("wrote", join(outDir, "sample.story"));
