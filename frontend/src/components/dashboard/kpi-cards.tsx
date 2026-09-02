import { Banknote, CheckCircle2, Copy, FolderTree, Package, Timer } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import type { Stats } from "@/lib/types";

/** 금액을 짧게: 2.1억원 / 2,070만원 / 9,800원 */
export function formatKrwCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, "")}억원`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

const ITEMS = [
  { key: "selected_categories", label: "선택 카테고리", icon: FolderTree, tone: "text-primary" },
  { key: "collected_products", label: "훑어본 상품", icon: Package, tone: "text-foreground" },
  { key: "unique_products", label: "중복 제외", icon: Copy, tone: "text-foreground" },
  { key: "monthly_measured_products", label: "30일 측정 완료", icon: Timer, tone: "text-foreground" },
  { key: "condition_passed_products", label: "조건 통과", icon: CheckCircle2, tone: "text-[var(--success)]" },
  { key: "passed_monthly_revenue", label: "통과 상품 30일 매출", icon: Banknote, tone: "text-primary" },
] as const;

export function KpiCards({
  stats,
  hasConditions = true,
}: {
  stats: Stats | null;
  hasConditions?: boolean;
}) {
  const value = (key: (typeof ITEMS)[number]["key"]): string => {
    if (!stats) return "-";
    if (key === "condition_passed_products" && !hasConditions) return "-";
    if (key === "passed_monthly_revenue") return hasConditions ? formatKrwCompact(stats[key]) : "-";
    return formatNumber(stats[key]);
  };
  return (
    <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
      {ITEMS.map(({ key, label, icon: Icon, tone }) => (
        <Card key={key} className="p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            <Icon className={`h-3.5 w-3.5 ${tone}`} />
          </div>
          <div className={`tabular mt-1 text-2xl font-semibold ${tone}`}>{value(key)}</div>
          {(key === "condition_passed_products" || key === "passed_monthly_revenue") && !hasConditions && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">조건 미설정</p>
          )}
          {key === "passed_monthly_revenue" && hasConditions && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">30일 예상판매 × 가격</p>
          )}
        </Card>
      ))}
    </div>
  );
}
