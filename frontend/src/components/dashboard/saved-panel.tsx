"use client";

import { Download, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPrice } from "@/lib/format";
import type { SavedProduct } from "@/lib/types";

function MemoCell({ item, onSave }: { item: SavedProduct; onSave: (memo: string) => void }) {
  const [draft, setDraft] = React.useState(item.memo ?? "");
  const [savedMemo, setSavedMemo] = React.useState(item.memo ?? "");
  // 서버에서 메모가 바뀌어 내려오면 입력값도 맞춘다 (렌더 중 상태 보정)
  if ((item.memo ?? "") !== savedMemo) {
    setSavedMemo(item.memo ?? "");
    setDraft(item.memo ?? "");
  }
  return (
    <Input
      value={draft}
      placeholder="메모"
      className="h-7 text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (item.memo ?? "") && onSave(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * 보관함. 검색을 새로 해도 사라지지 않는다.
 * 저장 당시 숫자와 현재 숫자를 나란히 보여준다.
 */
export function SavedPanel({
  items,
  loading,
  onRefresh,
  onRemove,
  onMemo,
  exportUrl,
}: {
  items: SavedProduct[];
  loading: boolean;
  onRefresh: () => void;
  onRemove: (item: SavedProduct) => void;
  onMemo: (item: SavedProduct, memo: string) => void;
  exportUrl: string;
}) {
  const nowRevenue = (p: SavedProduct["product"]) =>
    p.monthly_estimated_sales !== null && p.price !== null ? p.monthly_estimated_sales * p.price : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-xs text-muted-foreground">
          보관함 <b className="text-foreground">{items.length}</b>건 · 검색을 새로 해도 남아 있습니다. 숫자는{" "}
          <b>저장 당시</b>와 <b>현재</b>를 함께 보여줍니다.
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7" onClick={onRefresh}>
            <RefreshCw className={loading ? "animate-spin" : ""} /> 새로고침
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7"
            disabled={items.length === 0}
            onClick={() => window.open(exportUrl, "_blank", "noopener")}
          >
            <Download /> 엑셀로 내려받기
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">저장일</TableHead>
                <TableHead className="min-w-56">상품명</TableHead>
                <TableHead className="w-24 whitespace-nowrap text-right">30일 리뷰</TableHead>
                <TableHead className="w-28 whitespace-nowrap text-right">30일 예상판매</TableHead>
                <TableHead className="w-32 whitespace-nowrap text-right">30일 예상매출</TableHead>
                <TableHead className="w-32 whitespace-nowrap text-right">현재 30일 매출</TableHead>
                <TableHead className="w-28 whitespace-nowrap text-right">한 달 구매(쿠팡)</TableHead>
                <TableHead className="w-24 whitespace-nowrap text-right">가격</TableHead>
                <TableHead className="min-w-40">메모</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-xs text-muted-foreground">
                    보관한 상품이 없습니다. 결과 표의 ☆ 를 누르거나 [통과 상품 보관]을 쓰세요.
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(item.saved_at).toLocaleDateString("ko-KR")}
                  </TableCell>
                  <TableCell>
                    <a
                      href={item.product.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-2 hover:text-primary hover:underline"
                    >
                      {item.product.product_name}
                    </a>
                    <div className="truncate text-[10px] text-muted-foreground">{item.category_name ?? "-"}</div>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatNumber(item.monthly_review_count)}</TableCell>
                  <TableCell className="tabular text-right text-primary">{formatNumber(item.monthly_estimated_sales)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right font-medium">{formatPrice(item.monthly_revenue)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right text-muted-foreground">
                    {formatPrice(nowRevenue(item.product))}
                  </TableCell>
                  <TableCell className="tabular text-right" title={item.monthly_purchase_text ?? undefined}>
                    {item.monthly_purchase_count !== null ? `${formatNumber(item.monthly_purchase_count)}+` : "-"}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">{formatPrice(item.price)}</TableCell>
                  <TableCell>
                    <MemoCell item={item} onSave={(memo) => onMemo(item, memo)} />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      title="보관함에서 빼기"
                      aria-label="보관함에서 빼기"
                      onClick={() => onRemove(item)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
