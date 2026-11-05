// Reads the sheets of an .xlsx file in the browser, with no library: an .xlsx is a zip of XML files, and the browser can unzip them itself
// (DecompressionStream). Used by the admin pages that import a table from Excel. Values come back as text, row by row, with empty cells as "".

export interface Sheet {
  name: string;
  rows: string[][];
}

const u16 = (b: DataView, at: number) => b.getUint16(at, true);
const u32 = (b: DataView, at: number) => b.getUint32(at, true);

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files inside a zip, by name. Only the common kinds: stored or deflated, no zip64, no encryption. */
async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This is not an Excel (.xlsx) file.");
  const count = u16(view, end + 10);
  let at = u32(view, end + 16);
  const names = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (u32(view, at) !== 0x02014b50) throw new Error("This Excel file is damaged.");
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    const local = u32(view, at + 42);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.(xml|rels)$/i.test(name)) continue; // only the text parts matter here
    const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    const raw = bytes.subarray(start, start + size);
    files.set(name, method === 0 ? raw : method === 8 ? await inflate(raw) : new Uint8Array());
  }
  return files;
}

const xml = (bytes: Uint8Array | undefined) => new DOMParser().parseFromString(new TextDecoder().decode(bytes ?? new Uint8Array()), "application/xml");

/** "C7" → 2 (the column as a number, from 0) */
const columnOf = (ref: string) => [...ref.replace(/[0-9]/g, "")].reduce((sum, ch) => sum * 26 + ch.toUpperCase().charCodeAt(0) - 64, 0) - 1;

/** Every sheet of the workbook, in order. */
export async function readXlsx(file: File): Promise<Sheet[]> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open Excel files. Use a recent Chrome, Edge, Firefox or Safari.");
  const files = await unzip(await file.arrayBuffer());

  const strings = [...xml(files.get("xl/sharedStrings.xml")).getElementsByTagName("si")].map((si) =>
    // a string is one or more runs of text (<t>); phonetic hints (<rPh>) are not part of it
    [...si.getElementsByTagName("t")].filter((t) => t.parentElement?.tagName !== "rPh").map((t) => t.textContent ?? "").join(""),
  );

  const book = xml(files.get("xl/workbook.xml"));
  const rels = new Map([...xml(files.get("xl/_rels/workbook.xml.rels")).getElementsByTagName("Relationship")].map((r) => [r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? ""]));
  const sheets: Sheet[] = [];
  for (const sheet of [...book.getElementsByTagName("sheet")]) {
    const id = sheet.getAttribute("r:id") ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const target = (rels.get(id) ?? "").replace(/^\/?(xl\/)?/, "xl/");
    const doc = xml(files.get(target));
    const rows: string[][] = [];
    for (const row of [...doc.getElementsByTagName("row")]) {
      const cells: string[] = [];
      for (const c of [...row.getElementsByTagName("c")]) {
        const type = c.getAttribute("t");
        let value = "";
        if (type === "inlineStr") value = [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
        else {
          const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
          value = type === "s" ? (strings[Number(v)] ?? "") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
        }
        cells[columnOf(c.getAttribute("r") ?? "A1")] = value;
      }
      const index = Number(row.getAttribute("r")) - 1;
      rows[Number.isFinite(index) && index >= 0 ? index : rows.length] = Array.from(cells, (v) => v ?? "");
    }
    sheets.push({ name: sheet.getAttribute("name") ?? "", rows: Array.from(rows, (r) => r ?? []) });
  }
  return sheets;
}
