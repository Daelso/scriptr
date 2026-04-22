import JSZip from "jszip";

/**
 * Opens an EPUB (ZIP) byte array, finds the OPF file via META-INF/container.xml,
 * and returns the `version` attribute value from the `<package>` element.
 */
export async function readOpfVersion(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);

  // Step 1: parse META-INF/container.xml to find the OPF rootfile path.
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("META-INF/container.xml not found in EPUB");
  const containerXml = await containerFile.async("string");

  const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootfileMatch) throw new Error("Could not find rootfile full-path in container.xml");
  const opfPath = rootfileMatch[1];

  // Step 2: read the OPF file and extract <package version="...">.
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`OPF file not found at path: ${opfPath}`);
  const opfXml = await opfFile.async("string");

  const versionMatch = opfXml.match(/<package[^>]*\sversion="([^"]+)"/);
  if (!versionMatch) throw new Error("Could not find version attribute on <package> in OPF");
  return versionMatch[1];
}
