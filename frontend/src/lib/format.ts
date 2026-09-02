/** 화면 표시용 포매터. 값이 없으면 절대 임의 값을 만들지 않고 "-" 로 표시한다. */

const nf = new Intl.NumberFormat("ko-KR");

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return nf.format(value);
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${nf.format(value)}원`;
}

export function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(1);
}
