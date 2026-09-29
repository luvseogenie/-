// 외부 라이브러리 없이 zip 을 만든다 (xlsx 저장용). 브라우저(확장 페이지·서비스 워커)와 node 18+ 에서 동작.
// 항목마다 deflate(CompressionStream) 로 압축하고, 압축이 안 되는 환경이면 그대로(store) 넣는다.

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter(); writer.write(bytes); writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch { return null; }
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// files: { 이름: Uint8Array | string } → Uint8Array (zip)
export async function zip(files, { compress = true } = {}) {
  const enc = new TextEncoder(); const { time, date } = dosDateTime();
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const data = typeof raw === 'string' ? enc.encode(raw) : raw;
    const nameB = enc.encode(name);
    let method = 0, body = data;
    if (compress && data.length > 64) { const z = await deflateRaw(data); if (z && z.length < data.length) { method = 8; body = z; } }
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameB.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameB.length, true); lv.setUint16(28, 0, true); lh.set(nameB, 30);
    const ch = new Uint8Array(46 + nameB.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); ch.set(nameB, 46);
    locals.push(lh, body); centrals.push(ch); offset += lh.length + body.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const total = offset + cdSize + 22; const out = new Uint8Array(total); let p = 0;
  for (const part of [...locals, ...centrals, eocd]) { out.set(part, p); p += part.length; }
  return out;
}
