import { readFileSync } from "node:fs";
import { analyzePdfLines, fromPdfJsItems, itemsToLines, type PdfLine } from "@/lib/import/pdf-parse";

/** Same extraction as the browser loader, using pdf.js's Node build. */
export async function parsePdfFixture(path: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) });
  const doc = await task.promise;
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    lines.push(...itemsToLines(fromPdfJsItems(content.items as never[]), p));
  }
  const pages = doc.numPages;
  await task.destroy();
  return analyzePdfLines(lines, pages);
}
