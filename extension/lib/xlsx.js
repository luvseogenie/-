// 외부 라이브러리 없이 .xlsx(zip + XML) 와 .csv 를 읽는다. 브라우저(확장 페이지·서비스 워커)와 node 18+ 에서 동작.
// 쿠팡 '상품별 판매 리포트' 처럼 단순한 시트만 대상으로 한다 (공유 문자열, 인라인 문자열, 숫자, 수식의 캐시값).

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter(); writer.write(bytes); writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// zip 의 central directory 를 읽어 {이름: Uint8Array} 로 푼다.
export async function unzip(buf) {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다');
  const count = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true);
  const files = {}; const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nlen));
    const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lelen;
    const data = u8.slice(start, start + csize);
    files[name] = method === 8 ? await inflateRaw(data) : data;
    off += 46 + nlen + elen + clen;
  }
  return files;
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');
const textOf = (xml) => unescapeXml(xml.replace(/<[^>]+>/g, ''));
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export async function parseXlsx(buf) {
  const files = await unzip(buf); const dec = new TextDecoder();
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = dec.decode(files['xl/sharedStrings.xml']);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''));
  }
  // 시트 이름 → 파일 경로
  const wb = files['xl/workbook.xml'] ? dec.decode(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? dec.decode(files['xl/_rels/workbook.xml.rels']) : '';
  const relMap = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = m[0].match(/Id="([^"]+)"/)?.[1], t = m[0].match(/Target="([^"]+)"/)?.[1]; if (id && t) relMap[id] = t.replace(/^\/?(xl\/)?/, 'xl/'); }
  const sheets = [];
  const sheetTags = [...wb.matchAll(/<sheet\b[^>]*>/g)];
  const entries = sheetTags.length ? sheetTags.map((m) => ({ name: unescapeXml(m[0].match(/name="([^"]*)"/)?.[1] || ''), path: relMap[m[0].match(/r:id="([^"]+)"/)?.[1]] }))
    : Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort().map((p) => ({ name: p, path: p }));
  for (const { name, path } of entries) {
    if (!path || !files[path]) continue;
    const xml = dec.decode(files[path]); const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], inner = cm[2] || '';
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1]; const idx = ref ? colIndex(ref) : row.length;
        const type = attrs.match(/t="(\w+)"/)?.[1];
        let v = null;
        if (type === 's') { const n = inner.match(/<v>(\d+)<\/v>/)?.[1]; v = n != null ? shared[+n] : ''; }
        else if (type === 'inlineStr') v = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
        else if (type === 'str' || type === 'e') v = textOf(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
        else if (type === 'b') v = inner.includes('<v>1</v>');
        else { const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]; v = raw == null ? null : Number(raw); }
        while (row.length < idx) row.push(null);
        row[idx] = v;
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('시트를 찾지 못했습니다 (xlsx 파일이 맞는지 확인)');
  return sheets;
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

// 2차원 배열 → [{헤더: 값}]. 헤더 행은 mustHave 키워드를 모두 포함한 첫 행.
export function rowsToRecords(rows, mustHave = ['옵션', '매출']) {
  const norm = (v) => String(v ?? '').replace(/\s/g, '');
  let h = rows.findIndex((r) => { const j = r.map(norm).join('|'); return mustHave.every((k) => j.includes(k)); });
  if (h < 0) return [];
  const headers = rows[h].map((v) => String(v ?? '').trim());
  const out = [];
  for (const r of rows.slice(h + 1)) {
    if (!r || !r.some((c) => c != null && c !== '')) continue;
    const rec = {}; headers.forEach((hd, i) => { if (hd) rec[hd] = r[i] ?? ''; });
    out.push(rec);
  }
  return out;
}

// File / ArrayBuffer + 파일명 → records
export async function fileToRecords(buf, filename, mustHave) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (/�/.test(text)) text = new TextDecoder('euc-kr').decode(buf);
    return rowsToRecords(parseCsv(text.replace(/^﻿/, '')), mustHave);
  }
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x50 && u8[1] === 0x4b) { // zip → xlsx
    const sheets = await parseXlsx(buf);
    for (const s of sheets) { const recs = rowsToRecords(s.rows, mustHave); if (recs.length) return recs; }
    return [];
  }
  if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error('구형 .xls 형식입니다. 엑셀에서 "다른 이름으로 저장 → .xlsx 또는 CSV" 로 바꿔 올려 주세요.');
  // 텍스트(CSV) 일 수도 있다
  let text = new TextDecoder('utf-8').decode(buf);
  if (/�/.test(text)) text = new TextDecoder('euc-kr').decode(buf);
  return rowsToRecords(parseCsv(text.replace(/^﻿/, '')), mustHave);
}
