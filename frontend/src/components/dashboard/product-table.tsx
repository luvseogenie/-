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
import { DELIVERY_TYPES, type Product } from "@/lib/types";

function DeliveryBadge({ type }: { type: Product["delivery_type"] }) {
  if (!type) return <span className="text-muted-foreground">-</span>;
  const label = DELIVERY_TYPES[type] ?? type;
  const variant =
    type === "rocket_growth" ? "default" : type === "rocket" ? "warning" : "muted";
  return <Badge variant={variant}>{label}</Badge>;
}

export function ProductTable({
  products,
  loading,
  total,
  hasConditions,
}: {
  products: Product[];
  loading: boolean;
  total: number;
  /** 조건이 하나도 설정되지 않았으면 "조건 통과"라고 표시하지 않는다. */
  hasConditions: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">판정</TableHead>
              <TableHead className="min-w-64">상품명</TableHead>
              <TableHead className="w-32">카테고리</TableHead>
              <TableHead className="w-24 text-right">가격</TableHead>
              <TableHead className="w-20 text-right">리뷰수</TableHead>
              <TableHead className="w-28 text-right">예상 판매량</TableHead>
              <TableHead className="w-16 text-right">평점</TableHead>
              <TableHead className="w-20 text-right">조회수</TableHead>
              <TableHead className="w-28">배송</TableHead>
              <TableHead className="w-20">상품 링크</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && products.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!loading && products.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-xs text-muted-foreground">
                  수집된 상품이 없습니다.
                  <br />
                  Chrome에서 쿠팡 페이지를 열고 확장 프로그램의 [현재 페이지 수집]을 눌러주세요.
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
                </TableCell>
                <TableCell className="truncate text-xs text-muted-foreground">
                  {p.category_name ?? "-"}
                </TableCell>
                <TableCell className="tabular text-right">{formatPrice(p.price)}</TableCell>
                <TableCell className="tabular text-right">{formatNumber(p.review_count)}</TableCell>
                <TableCell className="tabular text-right font-medium text-primary">
                  {formatNumber(p.estimated_sales)}
                </TableCell>
                <TableCell className="tabular text-right">{formatRating(p.rating)}</TableCell>
                {/* 조회수는 데이터 원천이 없어 항상 "-" */}
                <TableCell className="tabular text-right text-muted-foreground">
                  {formatNumber(p.view_count)}
                </TableCell>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {formatNumber(products.length)}건 표시 / 전체 {formatNumber(total)}건
        </span>
        <span>예상 판매량 = 리뷰수 × 배수 (실제 판매량 아님)</span>
      </div>
    </div>
  );
}
