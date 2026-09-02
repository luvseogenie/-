// 라이브러리 없는 SVG 차트 (막대, 누적 막대, 선). 마우스 올리면 툴팁.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const fmtWon = (v) => (v < 0 ? '-' : '') + Math.round(Math.abs(v)).toLocaleString('ko-KR');
const short = (v) => { const a = Math.abs(v); const s = a >= 1e8 ? (a / 1e8).toFixed(1) + '억' : a >= 1e4 ? Math.round(a / 1e4).toLocaleString('ko-KR') + '만' : Math.round(a).toLocaleString('ko-KR'); return (v < 0 ? '-' : '') + s; };
const niceTicks = (min, max, n = 4) => {
  if (max === min) { max = min + 1; }
  const span = max - min; const raw = span / n; const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; const t = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(v); return t;
};

function frame(container) {
  container.innerHTML = '';
  const W = container.clientWidth || 600, H = container.clientHeight || 220;
  const m = { l: 52, r: 12, t: 10, b: 26 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` }, container);
  const tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; container.appendChild(tip);
  return { svg, tip, W, H, m, iw: W - m.l - m.r, ih: H - m.t - m.b };
}
function axes(f, ymin, ymax, dates) {
  const { svg, m, iw, ih } = f; const g = el('g', { class: 'grid' }, svg); const ax = el('g', { class: 'axis' }, svg);
  const ticks = niceTicks(ymin, ymax); const y = (v) => m.t + ih - ((v - ymin) / (ymax - ymin)) * ih;
  for (const t of ticks) { el('line', { x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t) }, g); const tx = el('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, ax); tx.textContent = short(t); }
  if (ymin < 0 && ymax > 0) el('line', { class: 'base', x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }, svg);
  const n = dates.length; const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 70))));
  dates.forEach((d, i) => { if (i % every === 0 || i === n - 1) { const tx = el('text', { x: m.l + (i + 0.5) * (iw / n), y: m.t + ih + 16, 'text-anchor': 'middle' }, ax); tx.textContent = d.slice(5).replace('-', '/'); } });
  return y;
}
function hover(f, dates, onIndex) {
  const { svg, tip, m, iw, ih } = f; const n = dates.length; const bw = iw / n;
  const cross = el('line', { class: 'cross', y1: m.t, y2: m.t + ih, x1: 0, x2: 0, style: 'display:none' }, svg);
  const hit = el('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih }, svg);
  hit.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * (f.W / r.width); const i = Math.max(0, Math.min(n - 1, Math.floor((x - m.l) / bw)));
    const cx = m.l + (i + 0.5) * bw; cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
    tip.innerHTML = onIndex(i); tip.style.display = ''; tip.style.left = (cx / f.W * r.width) + 'px'; tip.style.top = (m.t / f.H * r.height + 8) + 'px';
  });
  hit.addEventListener('mouseleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
}

// 부호별 색이 다른 막대 (순이익)
export function barChart(container, dates, values, { label = '순이익' } = {}) {
  const f = frame(container); if (!dates.length) return;
  const ymin = Math.min(0, ...values), ymax = Math.max(0, ...values); const y = axes(f, ymin, ymax, dates);
  const n = dates.length; const bw = f.iw / n; const gap = Math.min(4, bw * 0.25);
  values.forEach((v, i) => { const y0 = y(0), y1 = y(v); el('rect', { class: 'bar ' + (v < 0 ? 'neg' : 'pos'), x: f.m.l + i * bw + gap / 2, y: Math.min(y0, y1), width: Math.max(1, bw - gap), height: Math.max(1, Math.abs(y1 - y0)) }, f.svg); });
  hover(f, dates, (i) => `<b>${dates[i]}</b><div class="r"><span><i style="background:${values[i] < 0 ? '#d03b3b' : '#2a78d6'}"></i>${label}</span><span>${fmtWon(values[i])}원</span></div>`);
}
// 누적 막대 (광고 매출 + 자연 매출)
export function stackedChart(container, dates, series) {
  const f = frame(container); if (!dates.length) return;
  const totals = dates.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const y = axes(f, 0, Math.max(1, ...totals), dates); const n = dates.length; const bw = f.iw / n; const gap = Math.min(4, bw * 0.25);
  dates.forEach((_, i) => { let acc = 0; for (const s of series) { const v = s.values[i] || 0; if (!v) continue; const y1 = y(acc + v), y0 = y(acc); el('rect', { class: 'bar ' + s.cls, x: f.m.l + i * bw + gap / 2, y: y1, width: Math.max(1, bw - gap), height: Math.max(0, y0 - y1 - 1) }, f.svg); acc += v; } });
  hover(f, dates, (i) => `<b>${dates[i]}</b>` + series.map((s) => `<div class="r"><span><i style="background:${s.color}"></i>${s.label}</span><span>${fmtWon(s.values[i] || 0)}원</span></div>`).join('') + `<div class="r"><span>합계</span><span>${fmtWon(totals[i])}원</span></div>`);
}
// 여러 선 (같은 단위)
export function lineChart(container, dates, series) {
  const f = frame(container); if (!dates.length) return;
  const all = series.flatMap((s) => s.values); const y = axes(f, Math.min(0, ...all), Math.max(1, ...all), dates); const n = dates.length; const bw = f.iw / n;
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${(f.m.l + (i + 0.5) * bw).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    el('path', { class: 'ln ' + s.cls, d }, f.svg);
  }
  hover(f, dates, (i) => `<b>${dates[i]}</b>` + series.map((s) => `<div class="r"><span><i style="background:${s.color}"></i>${s.label}</span><span>${fmtWon(s.values[i] || 0)}${s.unit || '원'}</span></div>`).join(''));
}
// 작은 추세선 (표 안)
export function sparkline(values, w = 90, h = 24, color = '#2a78d6') {
  if (!values.length) return '';
  const min = Math.min(0, ...values), max = Math.max(1, ...values); const n = values.length;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1)) * w},${h - ((v - min) / (max - min)) * (h - 2) - 1}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}
