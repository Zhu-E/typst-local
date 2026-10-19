// Reads the family names a font file declares, so "unknown font family"
// messages can say which names the available fonts actually provide.

/** Returns the family names in a TrueType/OpenType font (first face of a collection). */
export function fontFamilies(buf) {
  try {
    let offset = 0;
    if (buf.toString('latin1', 0, 4) === 'ttcf') offset = buf.readUInt32BE(12);
    const numTables = buf.readUInt16BE(offset + 4);
    let name = null;
    for (let i = 0; i < numTables; i++) {
      const rec = offset + 12 + i * 16;
      if (buf.toString('latin1', rec, rec + 4) === 'name') name = buf.readUInt32BE(rec + 8);
    }
    if (name === null) return [];
    const count = buf.readUInt16BE(name + 2);
    const strings = name + buf.readUInt16BE(name + 4);
    const found = { 1: new Set(), 16: new Set() };
    for (let i = 0; i < count; i++) {
      const rec = name + 6 + i * 12;
      const platform = buf.readUInt16BE(rec);
      const nameId = buf.readUInt16BE(rec + 6);
      if (nameId !== 1 && nameId !== 16) continue;
      const len = buf.readUInt16BE(rec + 8);
      const start = strings + buf.readUInt16BE(rec + 10);
      const raw = buf.subarray(start, start + len);
      // Windows/Unicode names are UTF-16BE; Mac names are (roughly) Latin-1.
      const text = platform === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
      if (text.trim()) found[nameId].add(text.trim());
    }
    // Typst prefers the typographic family (16) and falls back to the legacy one (1).
    return [...(found[16].size ? found[16] : found[1])];
  } catch {
    return [];
  }
}
