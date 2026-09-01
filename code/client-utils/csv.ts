/** Row object keyed by header values. Values are strings for CSV/XML; Excel cells may be other types. */
export type ParsedRow = Record<string, unknown>;

/**
 * Unified file parser — handles both CSV and Excel (.xlsx/.xls) files.
 * For CSV: reads as text and parses with parseCSV().
 * For Excel: reads the first sheet and converts to array of row objects.
 *
 * @param {File} file  File object from <input type="file">
 * @returns {Promise<Array<Object>>}  Array of row objects keyed by header values
 */
export function parseFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const ext = (file.name || '').split('.').pop()!.toLowerCase();
    if (ext === 'xml') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try { resolve(parseXML(e.target!.result as string)); }
        catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Dynamic import: xlsx (~330KB) only loads when an Excel file is parsed.
        import('xlsx').then(XLSX => {
          try {
            const wb = XLSX.read(e.target!.result, { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json<ParsedRow>(ws, { defval: '', raw: false });
            resolve(rows);
          } catch (err) { reject(err); }
        }).catch(reject);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try { resolve(parseCSV(e.target!.result as string)); }
        catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    }
  });
}

export function parseFileColumns(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ext = (file.name || '').split('.').pop()!.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        import('xlsx').then(XLSX => {
          try {
            const wb = XLSX.read(e.target!.result, { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
            const headers = (rows[0] || []).map(h => String(h).trim()).filter(Boolean);
            resolve(headers);
          } catch (err) { reject(err); }
        }).catch(reject);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try { resolve(parseCSVHeaders(e.target!.result as string)); }
      catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    const headerSample = typeof file.slice === 'function' ? file.slice(0, 64 * 1024) : file;
    reader.readAsText(headerSample);
  });
}

export function parseCSVHeaders(text: string): string[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const record = parseFirstRecord(text);
  return record.map(h => h.trim()).filter(Boolean);
}

/**
 * RFC 4180-compliant CSV parser.
 * Handles:
 *   - BOM (U+FEFF) stripping (Excel UTF-8 exports)
 *   - Quoted fields containing commas, newlines, and escaped quotes ("")
 *   - CRLF and LF line endings
 *
 * @param {string} text  Raw CSV text
 * @returns {Array<Object>}  Array of row objects keyed by header values
 */
export function parseCSV(text: string): Record<string, string>[] {
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const records = parseRecords(text);
  if (records.length === 0) return [];

  const headers = records[0].map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    // Skip completely blank rows
    if (rec.every(v => v === '')) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = i < rec.length ? rec[i] : ''; });
    rows.push(obj);
  }

  return rows;
}

/**
 * Parses CSV text into a 2-D array [ [field, ...], ... ]
 */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '"') {
      // --- Quoted field ---
      let field = '';
      i++; // skip opening "
      while (i < text.length) {
        if (text[i] === '"' && i + 1 < text.length && text[i + 1] === '"') {
          field += '"'; i += 2; // escaped quote
        } else if (text[i] === '"') {
          i++; break; // closing quote
        } else {
          field += text[i++];
        }
      }
      record.push(field);
      // skip any garbage before next , or newline
      while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') i++;
    } else {
      // --- Unquoted field ---
      let start = i;
      while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') i++;
      record.push(text.slice(start, i).trim());
    }

    if (i >= text.length) {
      // End of input
      records.push(record);
      break;
    }

    if (text[i] === ',') {
      i++; // move to next field
    } else if (text[i] === '\r' || text[i] === '\n') {
      // End of record
      if (text[i] === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++; // CRLF
      i++;
      records.push(record);
      record = [];
    }
  }

  // Flush trailing record (handles files with no trailing newline)
  if (record.length > 0) {
    records.push(record);
  }

  // Drop last record if it's a single empty string (trailing newline artifact)
  if (records.length > 1) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === '') records.pop();
  }

  return records;
}

function parseFirstRecord(text: string): string[] {
  const record: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\r' || text[i] === '\n') break;

    if (text[i] === '"') {
      let field = '';
      i++;
      while (i < text.length) {
        if (text[i] === '"' && i + 1 < text.length && text[i + 1] === '"') {
          field += '"'; i += 2;
        } else if (text[i] === '"') {
          i++; break;
        } else {
          field += text[i++];
        }
      }
      record.push(field);
      while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') i++;
    } else {
      const start = i;
      while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') i++;
      record.push(text.slice(start, i).trim());
    }

    if (text[i] === ',') i++;
    else break;
  }

  return record;
}

/**
 * Parse an XML file into an array of row objects.
 * Expects repeated child elements under the root, each with text-only children
 * that become key/value pairs (like a spreadsheet export).
 *
 * @param {string} text  Raw XML text
 * @returns {Array<Object>}  Array of row objects
 */
function parseXML(text: string): Record<string, string>[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const errNode = doc.querySelector('parsererror');
  if (errNode) throw new Error('Invalid XML: ' + (errNode.textContent || '').slice(0, 200));

  const root = doc.documentElement;
  const rowElements = root.children;
  const rows: Record<string, string>[] = [];

  for (const el of rowElements) {
    const obj: Record<string, string> = {};
    for (const child of el.children) {
      obj[child.tagName] = child.textContent || '';
    }
    if (Object.keys(obj).length > 0) rows.push(obj);
  }

  if (!rows.length) throw new Error('No data rows found in XML file.');
  return rows;
}
