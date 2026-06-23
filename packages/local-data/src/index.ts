import type { ProductInput, Result } from "../../shared/src/index.js";
import { err, ok } from "../../shared/src/index.js";
import { inflateRawSync } from "node:zlib";

const PRODUCT_FIELDS = ["rowId", "productUrl", "productId", "title", "groupName", "remark"] as const;
const PRODUCT_FIELD_MAP = new Map(PRODUCT_FIELDS.map((field) => [normalizeHeaderKey(field), field]));

export type ProductInputFormat = "csv" | "json" | "xlsx" | "auto";

export function parseProductsInput(content: string, format: ProductInputFormat = "auto"): Result<ProductInput[]> {
  const resolvedFormat = format === "auto" ? inferInputFormat(content) : format;
  if (resolvedFormat === "json") {
    try {
      return parseProductsJson(JSON.parse(content));
    } catch (error) {
      return err(`Invalid JSON product input: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  if (resolvedFormat === "xlsx") {
    return err("XLSX product input must be parsed from a file buffer.");
  }
  return parseProductsCsv(content);
}

export function parseProductsCsv(content: string): Result<ProductInput[]> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return err("CSV must include a header and at least one data row.");
  }

  const headerResult = normalizeHeaders(splitCsvLine(lines[0]), "CSV");
  if (!headerResult.ok) {
    return headerResult;
  }
  const headers = headerResult.value;

  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] ?? "";
    });
    return row;
  });

  return normalizeProductRows(rows);
}

function inferInputFormat(content: string): Exclude<ProductInputFormat, "auto"> {
  const trimmed = content.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{") ? "json" : "csv";
}

export function parseProductsJson(records: unknown): Result<ProductInput[]> {
  if (!Array.isArray(records)) {
    return err("JSON product input must be an array.");
  }

  return normalizeProductRows(records as Array<Record<string, string>>);
}

export function parseProductsXlsx(content: Uint8Array): Result<ProductInput[]> {
  try {
    const entries = unzipXlsx(content);
    const sheet = entries.get("xl/worksheets/sheet1.xml")
      ?? [...entries.entries()].find(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))?.[1];
    if (!sheet) {
      return err("XLSX workbook must contain at least one worksheet.");
    }

    const sharedStrings = parseSharedStrings(decodeUtf8(entries.get("xl/sharedStrings.xml")));
    const rows = parseWorksheetRows(decodeUtf8(sheet), sharedStrings);
    if (rows.length < 2) {
      return err("XLSX must include a header row and at least one data row.");
    }

    const headerResult = normalizeHeaders(rows[0], "XLSX");
    if (!headerResult.ok) {
      return headerResult;
    }
    const headers = headerResult.value;

    const records = rows.slice(1)
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => {
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          if (header) {
            record[header] = row[index] ?? "";
          }
        });
        return record;
      });
    return normalizeProductRows(records);
  } catch (error) {
    return err(`Invalid XLSX product input: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

function normalizeHeaders(headers: string[], source: "CSV" | "XLSX"): Result<string[]> {
  const normalizedHeaders = headers.map((header) => PRODUCT_FIELD_MAP.get(normalizeHeaderKey(header)) ?? "");
  const unknownHeaders = headers.filter((header, index) => header.trim() && !normalizedHeaders[index]);
  if (unknownHeaders.length > 0) {
    return err(`Unknown ${source} headers: ${unknownHeaders.join(", ")}.`);
  }
  return ok(normalizedHeaders);
}

function normalizeHeaderKey(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function normalizeProductRows(rows: Array<Record<string, unknown>>): Result<ProductInput[]> {
  const products = rows.map((record, index) => normalizeProduct(record, index + 1));
  const invalidRows = products.filter((product) => !product.productUrl && !product.productId);
  if (invalidRows.length > 0) {
    return err(`Rows missing productUrl or productId: ${invalidRows.map((row) => row.rowId).join(", ")}.`);
  }
  const duplicateRowIds = findDuplicates(products.map((product) => product.rowId));
  if (duplicateRowIds.length > 0) {
    return err(`Duplicate rowId values: ${duplicateRowIds.join(", ")}.`);
  }
  return ok(products);
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function normalizeProduct(row: Record<string, unknown>, rowNumber: number): ProductInput {
  return {
    rowId: valueToString(row.rowId) || `row-${rowNumber}`,
    productUrl: emptyToUndefined(row.productUrl),
    productId: emptyToUndefined(row.productId),
    title: emptyToUndefined(row.title),
    groupName: emptyToUndefined(row.groupName),
    remark: emptyToUndefined(row.remark)
  };
}

function emptyToUndefined(value: unknown): string | undefined {
  const trimmed = valueToString(value);
  return trimmed ? trimmed : undefined;
}

function valueToString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function unzipXlsx(content: Uint8Array): Map<string, Uint8Array> {
  const buffer = content;
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = readUInt16LE(buffer, eocdOffset + 10);
  let offset = readUInt32LE(buffer, eocdOffset + 16);
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(buffer, offset) !== 0x02014b50) {
      throw new Error("Invalid XLSX central directory.");
    }
    const method = readUInt16LE(buffer, offset + 10);
    const compressedSize = readUInt32LE(buffer, offset + 20);
    const fileNameLength = readUInt16LE(buffer, offset + 28);
    const extraLength = readUInt16LE(buffer, offset + 30);
    const commentLength = readUInt16LE(buffer, offset + 32);
    const localHeaderOffset = readUInt32LE(buffer, offset + 42);
    const name = decodeUtf8(buffer.subarray(offset + 46, offset + 46 + fileNameLength));

    const localNameLength = readUInt16LE(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16LE(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0
      ? compressed
      : method === 8
        ? inflateRawSync(compressed)
        : undefined;
    if (!data) {
      throw new Error(`Unsupported XLSX compression method ${method} for ${name}.`);
    }

    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Uint8Array): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (readUInt32LE(buffer, offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Missing XLSX central directory.");
}

function decodeUtf8(content?: Uint8Array): string {
  return content ? new TextDecoder().decode(content) : "";
}

function readUInt16LE(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readUInt32LE(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset]
    | (buffer[offset + 1] << 8)
    | (buffer[offset + 2] << 16)
    | (buffer[offset + 3] * 0x1000000)
  ) >>> 0;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => xmlDecode(text[1])).join(""));
  }
  return strings;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const cellXml = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const columnIndex = ref ? columnNameToIndex(ref.replace(/\d+$/g, "")) : row.length;
      const rawValue = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const inlineValue = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => xmlDecode(text[1])).join("");
      row[columnIndex] = type === "s" ? sharedStrings[Number(rawValue)] ?? "" : inlineValue || xmlDecode(rawValue);
    }
    rows.push(row.map((cell) => cell ?? ""));
  }
  return rows;
}

function columnNameToIndex(columnName: string): number {
  return [...columnName.toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
