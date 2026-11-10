// Turns a PDF into plain text lines with pdf.js. pdf.js is passed in so the same
// code runs in the extension (bundled copy) and in tests (node copy).
export async function pdfToText(pdfjsLib, data) {
  // verbosity 0: only errors. Font-rendering warnings don't matter for text extraction.
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      let lastY = null;
      let lastEnd = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        // New line when the text moves up or down.
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(line);
          line = '';
          lastEnd = null;
        }
        // Add a space when there's a visible gap between text pieces on the same line.
        if (line && lastEnd !== null && x - lastEnd > 1 && !line.endsWith(' ') && !item.str.startsWith(' ')) line += ' ';
        line += item.str;
        lastY = y;
        lastEnd = x + (item.width || 0);
        if (item.hasEOL) {
          lines.push(line);
          line = '';
          lastY = null;
          lastEnd = null;
        }
      }
      if (line) lines.push(line);
    }
  } finally {
    await pdf.destroy();
  }
  return lines.join('\n');
}
