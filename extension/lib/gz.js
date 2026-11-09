// gzip 압축/풀기 (브라우저·서비스 워커·node 18+ 의 CompressionStream 사용). 자동 백업 JSON 을 1/10 쯤으로 줄인다.
export async function gzip(bytes) {
  const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
export async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
// 큰 객체(장부·광고 보고서 수십 MB)를 한 번에 문자열로 만들지 않고, 날짜 단위 조각으로 JSON 을 써 가며 바로 gzip 한다.
// 한꺼번에 JSON.stringify 하면 수백 MB 메모리를 써서 크롬이 확장을 멈출(충돌) 수 있다. bigKeys: 날짜별로 나눠 쓸 큰 항목
export async function gzipJsonStream(obj, bigKeys = []) {
  const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); const enc = new TextEncoder();
  const out = new Response(cs.readable).arrayBuffer();   // 읽는 쪽을 먼저 열어 두어야 쓰기가 막히지 않는다
  let rawLen = 0; const put = async (str) => { const b = enc.encode(str); rawLen += b.length; await w.write(b); };
  await put('{'); let first = true;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || typeof v === 'function') continue;
    await put((first ? '' : ',') + JSON.stringify(k) + ':'); first = false;
    if (bigKeys.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      await put('{'); let f2 = true;
      for (const [k2, v2] of Object.entries(v)) { if (v2 === undefined || typeof v2 === 'function') continue; await put((f2 ? '' : ',') + JSON.stringify(k2) + ':' + JSON.stringify(v2)); f2 = false; }
      await put('}');
    } else await put(JSON.stringify(v));
  }
  await put('}'); await w.close();
  return { bytes: new Uint8Array(await out), rawLen };
}
export const isGzip = (u8) => u8 && u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
// 백업 파일(JSON 또는 gzip JSON) → 객체
export async function readBackup(buf) {
  let u8 = new Uint8Array(buf); if (isGzip(u8)) u8 = await gunzip(u8);
  return JSON.parse(new TextDecoder().decode(u8));
}
