import ExcelJS from 'exceljs';

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
}

export async function buildWorkbook(sheets: { name: string; columns: SheetColumn[]; rows: Record<string, unknown>[]; title?: string }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(14, c.header.length + 2) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // A leading = + - @ would run as a formula in Excel, so text cells are neutralised on export.
    ws.addRows(sheet.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)]))));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function safeCell(v: unknown): unknown {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v !== null && typeof v === 'object') return String(v);
  return v ?? '';
}

export async function readFirstSheet(buffer: Buffer): Promise<{ row: number; values: Record<string, string> }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = cellText(cell.value);
  });
  const out: { row: number; values: Record<string, string> }[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (headers[col]) values[headers[col]] = cellText(cell.value);
    });
    if (Object.keys(values).length) out.push({ row: rowNumber, values });
  });
  return out;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text);
    if ('result' in value) return String(value.result ?? '');
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    return '';
  }
  return String(value).trim();
}
