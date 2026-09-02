"use client";

import * as React from "react";
import { Calculator, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MULTIPLIER_PRESETS } from "@/lib/types";

export function MultiplierPanel({
  multiplier,
  saving,
  onApply,
}: {
  multiplier: number;
  saving: boolean;
  onApply: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState(String(multiplier));
  // 서버에서 배수가 바뀌면 입력값을 맞춘다.
  // (effect 대신 렌더 중 보정 — React 공식 권장 패턴)
  const [lastMultiplier, setLastMultiplier] = React.useState(multiplier);
  if (lastMultiplier !== multiplier) {
    setLastMultiplier(multiplier);
    setDraft(String(multiplier));
  }

  const apply = (value: number) => {
    if (!Number.isFinite(value) || value < 1) return;
    onApply(Math.floor(value));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Calculator className="h-3.5 w-3.5 text-primary" />
        판매량 배수
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        예상 판매량 = 리뷰수 × 배수
        <br />
        <span className="text-[var(--warning)]">실제 판매량이 아닙니다.</span>
      </p>

      <div className="flex flex-wrap gap-1">
        {MULTIPLIER_PRESETS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={value === multiplier ? "default" : "outline"}
            className={cn("h-6 px-2 text-[11px]")}
            disabled={saving}
            onClick={() => apply(value)}
          >
            ×{value}
          </Button>
        ))}
      </div>

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          apply(Number(draft));
        }}
      >
        <Input
          type="number"
          min={1}
          max={1000}
          value={draft}
          aria-label="판매량 배수 직접 입력"
          onChange={(e) => setDraft(e.target.value)}
          className="h-7"
        />
        <Button type="submit" size="sm" variant="secondary" className="h-7 shrink-0" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "적용"}
        </Button>
      </form>
    </div>
  );
}
