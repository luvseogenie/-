// gzip 압축/풀기 (브라우저·서비스 워커·node 18+ 의 CompressionStream 사용). 자동 백업 JSON 을 1/10 쯤으로 줄인다.
export async function gzip(bytes) {
  const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
export async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
export const isGzip = (u8) => u8 && u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
// 백업 파일(JSON 또는 gzip JSON) → 객체
export async function readBackup(buf) {
  let u8 = new Uint8Array(buf); if (isGzip(u8)) u8 = await gunzip(u8);
  return JSON.parse(new TextDecoder().decode(u8));
}
