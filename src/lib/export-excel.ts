"use client";

import type { ExportDataset } from "./domain/csv";
import { buildWorkbook, workbookBlob, xlsxFileName, type WorkbookMeta } from "./domain/xlsx-export";
import { downloadBlob } from "./download";

/** Builds the .xlsx in the browser and downloads it. Returns the number of Generator rows. */
export async function exportInspectionXlsx(ds: ExportDataset, meta: Omit<WorkbookMeta, "generatedAt">): Promise<number> {
  const sheets = buildWorkbook(ds, { ...meta, generatedAt: new Date() });
  const blob = await workbookBlob(sheets);
  downloadBlob(xlsxFileName(meta.customer, meta.facility, ds.inspection.date), blob);
  return sheets[0].data.length - 1;
}
