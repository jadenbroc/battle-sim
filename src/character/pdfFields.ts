/** One form field of a PDF: its name, value, and where it sits on the page. */
export interface PdfField {
  name: string;
  value: string;
  /** 1-based page number. */
  page: number;
  /** Lower-left corner of the field, in PDF points (y grows upward). */
  x: number;
  y: number;
}

// The parts of pdf.js that reading form fields needs, so the same code runs in the browser and in tests.
interface PdfAnnotation {
  subtype: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  checkBox?: boolean;
  rect: number[];
}
interface PdfPage {
  getAnnotations(): Promise<PdfAnnotation[]>;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean; verbosity?: number }): { promise: Promise<PdfDocument> };
}

/** Field names in these PDFs have stray spaces ("Wpn2 AtkBonus ", "CLASS  LEVEL"): normalize them. */
export function normalizeFieldName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Read every filled-in text field of a PDF. D&D Beyond character sheets are fillable forms: the
 * character data is in named fields (CharacterName, STR, MaxHP, Wpn1 Damage, spellName0, ...).
 * Parsing happens entirely in the browser; nothing is uploaded.
 */
export async function readPdfFields(data: Uint8Array, pdfjs: PdfJsLike): Promise<PdfField[]> {
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const fields: PdfField[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const annotations = await (await doc.getPage(page)).getAnnotations();
    for (const a of annotations) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.fieldType !== 'Tx') continue;
      const raw = a.fieldValue;
      const value = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : '';
      fields.push({ name: normalizeFieldName(a.fieldName), value, page, x: a.rect[0] ?? 0, y: a.rect[1] ?? 0 });
    }
  }
  return fields;
}

/** Load pdf.js for the browser, with its worker. Kept out of the main bundle. */
export async function loadPdfJs(): Promise<PdfJsLike> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs as unknown as PdfJsLike;
}
