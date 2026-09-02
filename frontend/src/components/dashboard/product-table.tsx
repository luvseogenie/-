"use client";

import { ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPrice, formatRating } from "@/lib/format";
import { BREAKDOWN_LABELS, CONFIDENCE_LABELS,
  DELIVERY_TYPES,
  MONTHLY_METHODS,
  type Product, } from "@/lib/types";

function DeliveryBadge({ type }: { type: Product["delivery_type"] }) {
  if (!type) return <span className="text-muted-foreground">-</span>;
  const label = DELIVERY_TYPES[type] ?? type;
  const variant =
    type === "rocket_growth" ? "default" : type === "rocket" ? "warning" : "muted";
  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * 쿠팡이 표시한 한 달 구매 데이터.
 * 추정치가 아니라 쿠팡의 실제 판매 데이터이므로 가장 강조해서 보여준다.
 */
function PurchaseCell({ product }: { product: Product }) {
  if (product.monthly_purchase_count === null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const suffix = product.monthly_purchase_is_minimum ? "+" : "";
  const unit = product.monthly_purchase_unit ?? "명";
  return (
    <span
      className="font-semibold text-[var(--success)]"
      title={
        product.monthly_purchase_text
          ? `쿠팡 표시: "${product.monthly_purchase_text}했어요" (실제 판매 데이터)`
          : undefined
      }
    >
      {formatNumber(product.monthly_purchase_count)}
      {suffix}
      <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>
    </span>
  );
}

/**
 * 최근 30일 지표 표시.
 *
 * 쿠팡은 최근 1달 리뷰수를 제공하지 않으므로, 측정되지 않은 상품은 "-" 로 둔다.
 * 30일을 다 못 덮어 환산한 값은 "추정"으로 명확히 구분한다.
 */
function MonthlyCell({
  value,
  product,
  emphasize = false,
}: {
  value: number | null;
  product: Product;
  emphasize?: boolean;
}) {
  if (value === null || product.monthly_review_method === null) {
    return <span className="text-muted-foreground">-</span>;
  }

  const method = MONTHLY_METHODS[product.monthly_review_method];
  const days = product.monthly_review_window_days;
  const confidence = product.monthly_review_confidence
    ? CONFIDENCE_LABELS[product.monthly_review_confidence]
    : null;
  const title = [
    method?.hint,
    days ? `관측 구간 ${days}일` : null,
    product.monthly_review_sample_size !== null
      ? `표본 ${product.monthly_review_sample_size}건`
      : null,
    confidence ? `신뢰도 ${confidence.label}` : null,
    product.monthly_review_is_extrapolated
      ? "30일을 다 덮지 못해 환산한 추정값입니다"
      : "30일 구간 실측값입니다",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="inline-flex items-center justify-end gap-1" title={title}>
      <span className={emphasize ? "font-medium text-primary" : undefined}>
        {formatNumber(value)}
      </span>
      {emphasize && confidence && product.monthly_review_confidence !== "high" && (
        <span
          className={
            product.monthly_review_confidence === "low"
              ? "text-[10px] text-muted-foreground"
              : "text-[10px] text-[var(--warning)]"
          }
        >
          {product.monthly_review_is_extrapolated ? "추정" : confidence.label}
        </span>
      )}
    </span>
  );
}

export function ProductTable({
  products,
  loading,
  total,
  hasConditions,
  onToggleSave,
  breakdown,
  passedView,
}: {
  products: Product[];
  loading: boolean;
  total: number;
  /** 조건이 하나도 설정되지 않았으면 "조건 통과"라고 표시하지 않는다. */
  hasConditions: boolean;
  /** ☆ 보관함 넣기/빼기 */
  onToggleSave?: (product: Product) => void;
  /** 조건 통과 0건일 때 보여줄 조건별 탈락 수 */
  breakdown?: Record<string, number> | null;
  /** 지금 보고 있는 탭이 "조건 통과"인지 */
  passedView?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">판정</TableHead>
              <TableHead className="min-w-56">상품명</TableHead>
              <TableHead className="w-24 whitespace-nowrap text-right">30일 리뷰</TableHead>
              <TableHead className="w-32 whitespace-nowrap text-right">30일 예상판매</TableHead>
              <TableHead className="w-32 whitespace-nowrap text-right">30일 예상매출</TableHead>
              <TableHead className="w-28 whitespace-nowrap text-right">한 달 구매(쿠팡)</TableHead>
              <TableHead className="w-28 whitespace-nowrap text-right">가격</TableHead>
              <TableHead className="w-24 whitespace-nowrap text-right">누적 리뷰</TableHead>
              <TableHead className="w-16 text-right">평점</TableHead>
              <TableHead className="w-28">배송</TableHead>
              <TableHead className="w-20">상품 링크</TableHead>
              <TableHead className="w-12 text-center" title="보관함에 넣어 두면 검색을 새로 해도 사라지지 않습니다">보관</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && products.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!loading && products.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-xs text-muted-foreground">
                  {passedView && hasConditions && breakdown && Object.keys(breakdown).length > 0 ? (
                    <>
                      <b className="text-foreground">조건을 모두 만족하는 상품이 없습니다.</b>
                      <br />
                      조건별로 탈락시킨 상품 수 (한 상품이 여러 조건에 걸릴 수 있음):
                      <ul className="mx-auto mt-2 inline-block text-left leading-relaxed">
                        {Object.entries(breakdown)
                          .filter(([key]) => key !== "unmeasured")
                          .sort((a, b) => b[1] - a[1])
                          .map(([key, count]) => (
                            <li key={key}>
                              · {BREAKDOWN_LABELS[key] ?? key}: <b className="text-foreground">{formatNumber(count)}</b>개
                            </li>
                          ))}
                        {breakdown.unmeasured > 0 && (
                          <li className="mt-1 text-[11px]">
                            ※ 30일 리뷰수를 아직 못 잰 상품 {formatNumber(breakdown.unmeasured)}개 — 30일 조건은 측정 전엔 통과할 수 없습니다.
                            [소싱 시작]의 &quot;상세 확인 상품 수&quot;를 늘리거나, &quot;한 달 구매&quot; 칸을 비워 보세요.
                          </li>
                        )}
                      </ul>
                    </>
                  ) : (
                    <>
                      수집된 상품이 없습니다.
                      <br />
                      왼쪽에서 카테고리를 체크하고 [소싱 시작]을 누르세요.
                    </>
                  )}
                </TableCell>
              </TableRow>
            )}
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {!hasConditions ? (
                    <Badge variant="muted">조건 미설정</Badge>
                  ) : p.condition_passed ? (
                    <Badge variant="success">조건 통과</Badge>
                  ) : (
                    <Badge variant="muted">미달</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <a
                    href={p.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 hover:text-primary hover:underline"
                    title={p.product_name}
                  >
                    {p.product_name}
                  </a>
                  <div className="truncate text-[10px] text-muted-foreground">{p.category_name ?? "-"}</div>
                </TableCell>
                <TableCell className="tabular text-right">
                  <MonthlyCell value={p.monthly_review_count} product={p} />
                </TableCell>
                <TableCell className="tabular text-right">
                  <MonthlyCell value={p.monthly_estimated_sales} product={p} emphasize />
                </TableCell>
                {/* 30일 예상매출 = 30일 예상 판매량 × 가격. 둘 중 하나라도 없으면 "-" */}
                <TableCell className="tabular whitespace-nowrap text-right font-medium">
                  {p.monthly_estimated_sales !== null && p.price !== null
                    ? formatPrice(p.monthly_estimated_sales * p.price)
                    : "-"}
                </TableCell>
                <TableCell className="tabular text-right">
                  <PurchaseCell product={p} />
                </TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">{formatPrice(p.price)}</TableCell>
                <TableCell className="tabular text-right text-muted-foreground">{formatNumber(p.review_count)}</TableCell>
                <TableCell className="tabular text-right">{formatRating(p.rating)}</TableCell>
                <TableCell>
                  <DeliveryBadge type={p.delivery_type} />
                </TableCell>
                <TableCell>
                  <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[11px]">
                    <a href={p.product_url} target="_blank" rel="noopener noreferrer">
                      상품보기 <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <button
                    type="button"
                    className={`text-base leading-none ${p.saved ? "text-[var(--warning)]" : "text-muted-foreground hover:text-foreground"}`}
                    title={p.saved ? "보관함에서 빼기" : "보관함에 넣기"}
                    aria-label={p.saved ? "보관함에서 빼기" : "보관함에 넣기"}
                    onClick={() => onToggleSave?.(p)}
                  >
                    {p.saved ? "★" : "☆"}
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {formatNumber(products.length)}건 표시 / 전체 {formatNumber(total)}건
        </span>
        <span>
          예상 판매량 = 리뷰수 × 배수 · 30일 지표는 리뷰 날짜 분석 또는 리뷰수 변화 추적으로 산출
          (모두 추정치이며 실제 판매량이 아닙니다)
        </span>
      </div>
    </div>
  );
}
