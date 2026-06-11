export type PaperbackTrimSizeId =
  | "5x8"
  | "5.25x8"
  | "5.5x8.5"
  | "6x9"
  | "7x10"
  | "8x10"
  | "8.5x11";

export type PaperbackPaperType = "white" | "cream" | "color";

export type PaperbackOptions = {
  trimSizeId: PaperbackTrimSizeId;
  bleed: boolean;
  paperType: PaperbackPaperType;
  fontSizePt: number;
  lineHeight: number;
  pageCountOverride?: number;
};

export type PaperbackTrimSize = {
  id: PaperbackTrimSizeId;
  label: string;
  widthIn: number;
  heightIn: number;
};

export type PaperbackMarginSpec = {
  insideIn: number;
  outsideIn: number;
  topIn: number;
  bottomIn: number;
};

export type PaperbackCoverSpec = {
  trimSize: PaperbackTrimSize;
  pageCount: number;
  paperType: PaperbackPaperType;
  bleedIn: number;
  spineWidthIn: number;
  coverWidthIn: number;
  coverHeightIn: number;
  safeTextFromOutsideEdgeIn: number;
  spineTextAllowed: boolean;
  spineTextSafeMarginIn: number;
};

export const PAPERBACK_TRIM_SIZES: PaperbackTrimSize[] = [
  { id: "5x8", label: '5" x 8"', widthIn: 5, heightIn: 8 },
  { id: "5.25x8", label: '5.25" x 8"', widthIn: 5.25, heightIn: 8 },
  { id: "5.5x8.5", label: '5.5" x 8.5"', widthIn: 5.5, heightIn: 8.5 },
  { id: "6x9", label: '6" x 9"', widthIn: 6, heightIn: 9 },
  { id: "7x10", label: '7" x 10"', widthIn: 7, heightIn: 10 },
  { id: "8x10", label: '8" x 10"', widthIn: 8, heightIn: 10 },
  { id: "8.5x11", label: '8.5" x 11"', widthIn: 8.5, heightIn: 11 },
];

export const DEFAULT_PAPERBACK_OPTIONS: PaperbackOptions = {
  trimSizeId: "6x9",
  bleed: false,
  paperType: "white",
  fontSizePt: 11,
  lineHeight: 1.45,
};

export function getPaperbackTrimSize(id: PaperbackTrimSizeId): PaperbackTrimSize {
  return PAPERBACK_TRIM_SIZES.find((size) => size.id === id) ?? PAPERBACK_TRIM_SIZES[3];
}

export function normalizePaperbackOptions(input: Partial<PaperbackOptions> = {}): PaperbackOptions {
  const trimSizeId = PAPERBACK_TRIM_SIZES.some((size) => size.id === input.trimSizeId)
    ? input.trimSizeId!
    : DEFAULT_PAPERBACK_OPTIONS.trimSizeId;
  const paperType: PaperbackPaperType =
    input.paperType === "cream" || input.paperType === "color" || input.paperType === "white"
      ? input.paperType
      : DEFAULT_PAPERBACK_OPTIONS.paperType;
  const fontSizePt =
    typeof input.fontSizePt === "number" && Number.isFinite(input.fontSizePt)
      ? Math.min(14, Math.max(7, input.fontSizePt))
      : DEFAULT_PAPERBACK_OPTIONS.fontSizePt;
  const lineHeight =
    typeof input.lineHeight === "number" && Number.isFinite(input.lineHeight)
      ? Math.min(2, Math.max(1.1, input.lineHeight))
      : DEFAULT_PAPERBACK_OPTIONS.lineHeight;
  const pageCountOverride =
    typeof input.pageCountOverride === "number" && Number.isFinite(input.pageCountOverride)
      ? Math.max(24, Math.ceil(input.pageCountOverride))
      : undefined;

  return {
    trimSizeId,
    bleed: Boolean(input.bleed),
    paperType,
    fontSizePt,
    lineHeight,
    pageCountOverride,
  };
}

export function evenPageCount(pageCount: number): number {
  const rounded = Math.max(24, Math.ceil(pageCount));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function estimatePaperbackPageCount(wordCount: number, backmatterPages = 0): number {
  const bodyPages = Math.ceil(Math.max(0, wordCount) / 300);
  return evenPageCount(4 + bodyPages + backmatterPages);
}

export function paperbackInteriorPageSize(trim: PaperbackTrimSize, bleed: boolean) {
  return {
    widthIn: bleed ? trim.widthIn + 0.125 : trim.widthIn,
    heightIn: bleed ? trim.heightIn + 0.25 : trim.heightIn,
  };
}

export function paperbackMinimumMargins(pageCount: number, bleed: boolean): PaperbackMarginSpec {
  const count = Math.max(24, pageCount);
  const insideIn =
    count <= 150 ? 0.375 :
    count <= 300 ? 0.5 :
    count <= 500 ? 0.625 :
    count <= 700 ? 0.75 :
    0.875;
  const outsideIn = bleed ? 0.375 : 0.25;
  return {
    insideIn,
    outsideIn,
    topIn: 0.5,
    bottomIn: 0.5,
  };
}

export function calculatePaperbackCoverSpec(
  opts: PaperbackOptions,
  estimatedPageCount: number,
): PaperbackCoverSpec {
  const options = normalizePaperbackOptions(opts);
  const trimSize = getPaperbackTrimSize(options.trimSizeId);
  const pageCount = evenPageCount(options.pageCountOverride ?? estimatedPageCount);
  const spineFactor =
    options.paperType === "cream" ? 0.0025 :
    options.paperType === "color" ? 0.002347 :
    0.002252;
  const bleedIn = 0.125;
  const spineWidthIn = pageCount * spineFactor;

  return {
    trimSize,
    pageCount,
    paperType: options.paperType,
    bleedIn,
    spineWidthIn,
    coverWidthIn: bleedIn + trimSize.widthIn + spineWidthIn + trimSize.widthIn + bleedIn,
    coverHeightIn: bleedIn + trimSize.heightIn + bleedIn,
    safeTextFromOutsideEdgeIn: 0.25,
    spineTextAllowed: pageCount > 79,
    spineTextSafeMarginIn: 0.0625,
  };
}

export function inches(n: number): string {
  return `${Number(n.toFixed(3))}"`;
}
