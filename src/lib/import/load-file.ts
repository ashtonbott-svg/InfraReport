"use client";

/**
 * Reads an uploaded equipment list in the browser. Nothing is uploaded to a
 * server: PDF text, Excel cells and CSV text are parsed on this device.
 */
import { parseCsv } from "../domain/csv";
import { analyzePdfLines, fromPdfJsItems, itemsToLines, type PdfLine, type PdfParseResult } from "./pdf-parse";
import { markDuplicates, parseTabular, type ProposedRow } from "./table";

export type ImportSource =
  | { kind: "pdf"; fileName: string; pdf: PdfParseResult }
  | { kind: "sheet"; fileName: string; sheets: { name: string; rows: ProposedRow[]; ignoredColumns: string[]; found: boolean }[] };

export const ACCEPTED = ".pdf,.csv,.txt,.xlsx,.xlsm";

export async function loadPdf(data: ArrayBuffer): Promise<{ lines: PdfLine[]; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    lines.push(...itemsToLines(fromPdfJsItems(content.items as never[]), p));
    page.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();
  return { lines, pages };
}

export function csvToRows(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("\t") && !first.includes(",")) return t.split(/\r?\n/).map((l) => l.split("\t"));
  if ((first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length) {
    return parseCsv(t.replace(/;/g, ","));
  }
  return parseCsv(t);
}

export async function readImportFile(file: File): Promise<ImportSource> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { lines, pages } = await loadPdf(await file.arrayBuffer());
    return { kind: "pdf", fileName: file.name, pdf: analyzePdfLines(lines, pages) };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const { default: readXlsx } = await import("read-excel-file/universal");
    const sheets = (await readXlsx(file)) as { sheet: string; data: unknown[][] }[];
    return {
      kind: "sheet",
      fileName: file.name,
      sheets: sheets.map((s) => {
        const rows = s.data.map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
        const parsed = parseTabular(rows, (i) => `${s.sheet} row ${i + 1}`);
        return { name: s.sheet, rows: markDuplicates(parsed.rows), ignoredColumns: parsed.ignoredColumns, found: !!parsed.header };
      }),
    };
  }
  if (name.endsWith(".xls")) throw new Error("Old .xls workbooks cannot be read here. In Excel use File > Save As > .xlsx (or CSV), then import that file.");
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type.startsWith("text/")) {
    const parsed = parseTabular(csvToRows(await file.text()));
    return { kind: "sheet", fileName: file.name, sheets: [{ name: "CSV", rows: markDuplicates(parsed.rows), ignoredColumns: parsed.ignoredColumns, found: !!parsed.header }] };
  }
  throw new Error("Unsupported file type. Use PDF, Excel (.xlsx / .xlsm) or CSV.");
}
