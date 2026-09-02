import { CheckCircle2, Copy, FolderTree, Package, ShoppingCart } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import type { Stats } from "@/lib/types";

const ITEMS = [
  { key: "selected_categories", label: "선택 카테고리", icon: FolderTree, tone: "text-primary" },
  { key: "collected_products", label: "수집 상품", icon: Package, tone: "text-foreground" },
  { key: "unique_products", label: "중복 제외", icon: Copy, tone: "text-foreground" },
  {
    key: "purchase_labeled_products",
    label: "구매수 확보",
    icon: ShoppingCart,
    tone: "text-foreground",
  },
  {
    key: "condition_passed_products",
    label: "조건 통과",
    icon: CheckCircle2,
    tone: "text-[var(--success)]",
  },
] as const;

export function KpiCards({
  stats,
  hasConditions = true,
}: {
  stats: Stats | null;
  hasConditions?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {ITEMS.map(({ key, label, icon: Icon, tone }) => (
        <Card key={key} className="p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            <Icon className={`h-3.5 w-3.5 ${tone}`} />
          </div>
          <div className={`tabular mt-1 text-2xl font-semibold ${tone}`}>
            {key === "condition_passed_products" && !hasConditions
              ? "-"
              : stats
                ? formatNumber(stats[key])
                : "-"}
          </div>
          {key === "condition_passed_products" && !hasConditions && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">조건 미설정</p>
          )}
        </Card>
      ))}
    </div>
  );
}
