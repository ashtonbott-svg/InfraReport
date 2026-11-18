"use client";

import { inspectionStartDate, type ExportDataset, type ExportFormat } from "./domain/csv";
import { buildWorkbookFor, workbookBlob, xlsxFileName, type WorkbookMeta } from "./domain/xlsx-export";
import { downloadBlob } from "./download";

/** Builds the .xlsx in the browser and downloads it. Read only: the inspection is not changed. Returns the number of data rows. */
export async function exportInspectionXlsx(ds: ExportDataset, meta: Omit<WorkbookMeta, "generatedAt">, format: ExportFormat = "infinite"): Promise<number> {
  const sheets = buildWorkbookFor(format, ds, { ...meta, generatedAt: new Date() });
  const blob = await workbookBlob(sheets);
  downloadBlob(xlsxFileName(meta.customer, meta.facility, inspectionStartDate(ds), format), blob);
  return sheets[0].data.length - 1;
}
