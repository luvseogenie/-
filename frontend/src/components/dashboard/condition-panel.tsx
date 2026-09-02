"use client";

import { SlidersHorizontal } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DELIVERY_TYPES, type Conditions, type DeliveryType } from "@/lib/types";

type RangeKeys =
  | ["price_min", "price_max"]
  | ["review_min", "review_max"]
  | ["sales_min", "sales_max"]
  | ["rating_min", "rating_max"];

const RANGES: { label: string; keys: RangeKeys; step?: string; placeholder: [string, string] }[] = [
  { label: "판매가격 (원)", keys: ["price_min", "price_max"], placeholder: ["9000", "100000"] },
  { label: "리뷰 수", keys: ["review_min", "review_max"], placeholder: ["0", "250"] },
  { label: "예상 판매량", keys: ["sales_min", "sales_max"], placeholder: ["1000", "10000"] },
  { label: "평점", keys: ["rating_min", "rating_max"], step: "0.1", placeholder: ["4.0", "5.0"] },
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
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
        상품 조건
      </div>

      {RANGES.map(({ label, keys, step, placeholder }) => (
        <div key={label} className="space-y-1">
          <Label>{label}</Label>
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
