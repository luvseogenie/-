"use client";

import { SlidersHorizontal, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DELIVERY_TYPES,
  SOURCING_PRESETS,
  type Conditions,
  type DeliveryType,
} from "@/lib/types";

type RangeKeys =
  | ["price_min", "price_max"]
  | ["review_min", "review_max"]
  | ["sales_min", "sales_max"]
  | ["purchase_min", "purchase_max"]
  | ["monthly_review_min", "monthly_review_max"]
  | ["monthly_sales_min", "monthly_sales_max"]
  | ["rating_min", "rating_max"];

type Range = {
  label: string;
  keys: RangeKeys;
  step?: string;
  placeholder: [string, string];
  note?: string;
};

const RANGES: Range[] = [
  {
    label: "최근 30일 예상 판매량",
    keys: ["monthly_sales_min", "monthly_sales_max"],
    placeholder: ["최소", "최대"],
    note: "30일 리뷰수 × 배수 · 핵심 지표",
  },
  {
    label: "최근 30일 리뷰수",
    keys: ["monthly_review_min", "monthly_review_max"],
    placeholder: ["최소", "최대"],
    note: "측정된 상품만 통과합니다",
  },
  { label: "판매가격 (원)", keys: ["price_min", "price_max"], placeholder: ["최소", "최대"] },
  { label: "리뷰 수 (누적)", keys: ["review_min", "review_max"], placeholder: ["최소", "최대"] },
  { label: "평점", keys: ["rating_min", "rating_max"], step: "0.1", placeholder: ["최소", "최대"] },
  {
    label: "한 달 구매 (쿠팡 표시)",
    keys: ["purchase_min", "purchase_max"],
    placeholder: ["최소", "최대"],
    note: "2차 확인용 · 문구가 있는 상품만 통과",
  },
  { label: "예상 판매량 (누적 리뷰 × 배수)", keys: ["sales_min", "sales_max"], placeholder: ["최소", "최대"], note: "참고용" },
];


const DELIVERY_OPTIONS: DeliveryType[] = ["rocket_growth", "rocket", "seller"];

export function ConditionPanel({
  conditions,
  onChange,
}: {
  conditions: Conditions;
  onChange: (next: Conditions) => void;
}) {
  const setField = (key: keyof Conditions, value: string) =>
    onChange({ ...conditions, [key]: value });

  const toggleDelivery = (type: DeliveryType) => {
    const has = conditions.delivery_types.includes(type);
    onChange({
      ...conditions,
      delivery_types: has
        ? conditions.delivery_types.filter((t) => t !== type)
        : [...conditions.delivery_types, type],
    });
  };

  const allChecked = conditions.delivery_types.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {/* 소싱 기준 프리셋 — 쿠팡이 표시하는 "한 달간 N명 이상 구매" 문구 기준 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Target className="h-3.5 w-3.5 text-primary" />
          소싱 기준
        </div>
        <div className="flex flex-wrap gap-1">
          {SOURCING_PRESETS.map((preset) => (
            <Button
              key={preset.monthlySalesMin}
              size="sm"
              variant={
                conditions.monthly_sales_min === String(preset.monthlySalesMin) ? "default" : "outline"
              }
              className="h-6 px-2 text-[11px]"
              title={`${preset.note} · 최근 30일 예상 판매량 ${preset.monthlySalesMin.toLocaleString()}개 이상`}
              onClick={() =>
                onChange({
                  ...conditions,
                  monthly_sales_min:
                    conditions.monthly_sales_min === String(preset.monthlySalesMin)
                      ? ""
                      : String(preset.monthlySalesMin),
                })
              }
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <b>최근 30일 리뷰수 × 배수</b>로 추정한 30일 예상 판매량 기준입니다 (배수 20이면 월 1,000개 = 30일
          리뷰 50건). 쿠팡의 &quot;한 달간 N명 구매&quot; 문구는 2차 확인용으로 함께 저장됩니다.
        </p>
      </div>

      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
        상품 조건
      </div>

      {RANGES.map(({ label, keys, step, placeholder, note }) => (
        <div key={label} className="space-y-1">
          <Label>
            {label}
            {note && <span className="ml-1 text-[10px] opacity-70">· {note}</span>}
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="decimal"
              step={step}
              min={0}
              placeholder={placeholder[0]}
              aria-label={`${label} 최소`}
              value={conditions[keys[0]] as string}
              onChange={(e) => setField(keys[0], e.target.value)}
            />
            <span className="text-xs text-muted-foreground">~</span>
            <Input
              type="number"
              inputMode="decimal"
              step={step}
              min={0}
              placeholder={placeholder[1]}
              aria-label={`${label} 최대`}
              value={conditions[keys[1]] as string}
              onChange={(e) => setField(keys[1], e.target.value)}
            />
          </div>
        </div>
      ))}

      <div className="space-y-1.5">
        <Label>배송방식</Label>
        <div className="grid gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={allChecked}
              onCheckedChange={() => onChange({ ...conditions, delivery_types: [] })}
            />
            전체
          </label>
          {DELIVERY_OPTIONS.map((type) => (
            <label key={type} className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={conditions.delivery_types.includes(type)}
                onCheckedChange={() => toggleDelivery(type)}
              />
              {DELIVERY_TYPES[type]}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
