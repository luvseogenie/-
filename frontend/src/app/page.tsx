"use client";

import * as React from "react";
import { AlertCircle, RefreshCw, Search, ShoppingCart } from "lucide-react";

import { CategoryTree } from "@/components/dashboard/category-tree";
import { ConditionPanel } from "@/components/dashboard/condition-panel";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MultiplierPanel } from "@/components/dashboard/multiplier-panel";
import { ProductTable } from "@/components/dashboard/product-table";
import { ScanPanel } from "@/components/dashboard/scan-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api, buildQuery } from "@/lib/api";
import {
  DEFAULT_CONDITIONS,
  SORT_OPTIONS,
  type CategoryTreeNode,
  type Conditions,
  type Product,
  type ScanStatus,
  type Stats,
} from "@/lib/types";

export default function DashboardPage() {
  const [tree, setTree] = React.useState<CategoryTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = React.useState(true);
  const [treeError, setTreeError] = React.useState<string | null>(null);

  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [conditions, setConditions] = React.useState<Conditions>(DEFAULT_CONDITIONS);
  const [multiplier, setMultiplier] = React.useState(20);
  const [savingMultiplier, setSavingMultiplier] = React.useState(false);

  const [onlyPassed, setOnlyPassed] = React.useState(false);
  /** 2단계: 구매 문구를 아직 확인하지 못한 상품만 보기 */
  const [onlyPending, setOnlyPending] = React.useState(false);

  /** 자동 스캔 설정·상태 */
  const [scanPages, setScanPages] = React.useState(1);
  const [scanDetailLimit, setScanDetailLimit] = React.useState(50);
  const [scanStatus, setScanStatus] = React.useState<ScanStatus | null>(null);
  const [scanStarting, setScanStarting] = React.useState(false);
  const [sort, setSort] = React.useState<string>("sales_desc");
  const [keyword, setKeyword] = React.useState("");
  const [debouncedKeyword, setDebouncedKeyword] = React.useState("");

  const [products, setProducts] = React.useState<Product[]>([]);
  const [total, setTotal] = React.useState(0);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // 카테고리 트리 + 설정 최초 로드
  const [treeReloadKey, setTreeReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setTreeLoading(true);
      setTreeError(null);
      try {
        const data = await api.categoryTree();
        if (!cancelled) setTree(data);
      } catch (e) {
        if (!cancelled) {
          setTreeError(e instanceof Error ? e.message : "카테고리를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
      try {
        const s = await api.settings();
        if (!cancelled) setMultiplier(s.review_sales_multiplier);
      } catch {
        // 설정 조회 실패는 화면을 막지 않는다. 상품 조회 시 에러가 표시된다.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [treeReloadKey]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const selectedIds = React.useMemo(() => [...selected], [selected]);

  /** 조건이 하나라도 입력되어 있는지. 없으면 모든 상품이 통과로 계산되므로 UI에서 구분한다. */
  const hasConditions = React.useMemo(() => {
    const { delivery_types, ...ranges } = conditions;
    return delivery_types.length > 0 || Object.values(ranges).some((v) => v !== "");
  }, [conditions]);

  // 수동 새로고침 / 수집 시작 후 재조회에 쓰는 키
  const [reloadKey, setReloadKey] = React.useState(0);
  const refresh = React.useCallback(() => setReloadKey((k) => k + 1), []);
  /** 헤더의 새로고침: 카테고리 트리까지 다시 읽는다. */
  const refreshAll = React.useCallback(() => {
    setTreeReloadKey((k) => k + 1);
    setReloadKey((k) => k + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      // 미확인 후보만 볼 때는 구매수 조건을 빼야 한다(아직 값이 없으므로 전부 탈락한다).
      const listConditions = onlyPending
        ? { ...conditions, purchase_min: "", purchase_max: "" }
        : conditions;
      const listQuery = buildQuery(listConditions, selectedIds, {
        sort,
        q: debouncedKeyword || undefined,
        page_size: 200,
        condition_passed: onlyPassed || onlyPending ? true : undefined,
        has_purchase: onlyPending ? false : undefined,
      });
      const statsQuery = buildQuery(conditions, selectedIds, { q: debouncedKeyword || undefined });
      try {
        const [list, kpi] = await Promise.all([api.products(listQuery), api.stats(statsQuery)]);
        // 조건을 빠르게 바꾸면 이전 응답이 나중에 도착할 수 있다. 취소된 요청은 버린다.
        if (cancelled) return;
        setProducts(list.items);
        setTotal(list.total);
        setStats(kpi);
        setMultiplier(kpi.review_sales_multiplier);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [conditions, selectedIds, sort, debouncedKeyword, onlyPassed, onlyPending, reloadKey]);

  const applyMultiplier = async (value: number) => {
    setSavingMultiplier(true);
    setError(null);
    try {
      const res = await api.updateSettings(value);
      setMultiplier(res.review_sales_multiplier);
      setNotice(`배수 ×${res.review_sales_multiplier} 적용 — 상품 ${res.recalculated_products}건 재계산`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "배수를 저장하지 못했습니다.");
    } finally {
      setSavingMultiplier(false);
    }
  };

  /** 스캔 진행률 폴링. 진행 중일 땐 3초마다, 아니면 15초마다 확인한다. */
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const status = await api.scanStatus();
        if (cancelled) return;
        setScanStatus(status);
        const active = status?.status === "running" || status?.status === "paused";
        // 수집이 진행되는 동안 결과 테이블도 같이 갱신한다.
        if (status?.status === "running") setReloadKey((k) => k + 1);
        timer = setTimeout(() => void tick(), active ? 3000 : 15000);
      } catch {
        if (!cancelled) timer = setTimeout(() => void tick(), 15000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const toNumber = (value: string): number | null => (value === "" ? null : Number(value));

  /** 소싱 시작: 선택한 카테고리(하위 포함)의 목록 페이지 → 후보 상세 페이지를 자동 순회한다. */
  const startScan = async () => {
    setError(null);
    setScanStarting(true);
    try {
      const res = await api.scanStart({
        category_ids: selectedIds,
        pages_per_category: scanPages,
        detail_limit: scanDetailLimit,
        conditions: {
          price_min: toNumber(conditions.price_min),
          price_max: toNumber(conditions.price_max),
          review_min: toNumber(conditions.review_min),
          review_max: toNumber(conditions.review_max),
          rating_min: toNumber(conditions.rating_min),
          rating_max: toNumber(conditions.rating_max),
          delivery_types: conditions.delivery_types,
        },
      });
      setScanStatus(await api.scanStatus());
      setNotice(`${res.message}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "스캔을 시작하지 못했습니다.");
    } finally {
      setScanStarting(false);
    }
  };

  const scanControl = async (action: "pause" | "resume" | "stop") => {
    setError(null);
    try {
      const status =
        action === "pause"
          ? await api.scanPause()
          : action === "resume"
            ? await api.scanResume()
            : await api.scanStop();
      setScanStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
    }
  };

  /** 조건 통과 상품을 엑셀(CSV)로 내려받는다. */
  const exportExcel = () => {
    const query = buildQuery(conditions, selectedIds, {
      q: debouncedKeyword || undefined,
      condition_passed: true,
      sort,
    });
    window.open(api.exportUrl(query), "_blank", "noopener");
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold">쿠팡 상품 소싱 분석</h1>
          <span className="text-[11px] text-muted-foreground">MVP 1단계</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>배수 ×{multiplier}</span>
          <Button variant="ghost" size="sm" className="h-7" onClick={refreshAll}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            새로고침
          </Button>
        </div>
      </header>

      {(error || notice) && (
        <div
          className={`flex shrink-0 items-start gap-2 border-b px-4 py-1.5 text-xs ${
            error
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-primary/10 text-primary"
          }`}
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error ?? notice}</span>
          <button
            type="button"
            className="opacity-60 hover:opacity-100"
            onClick={() => (error ? setError(null) : setNotice(null))}
          >
            닫기
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 왼쪽 25% */}
        <aside className="flex w-1/4 min-w-72 max-w-96 flex-col gap-3 overflow-y-auto border-r border-border p-3 [&>*]:shrink-0">
          <CategoryTree
            tree={tree}
            loading={treeLoading}
            error={treeError}
            selected={selected}
            onChange={setSelected}
          />
          <Separator />
          <ConditionPanel conditions={conditions} onChange={setConditions} />
          <Separator />
          <MultiplierPanel multiplier={multiplier} saving={savingMultiplier} onApply={applyMultiplier} />
          <Separator />
          <ScanPanel
            selectedCount={selected.size}
            pages={scanPages}
            detailLimit={scanDetailLimit}
            status={scanStatus}
            starting={scanStarting}
            onPagesChange={setScanPages}
            onDetailLimitChange={setScanDetailLimit}
            onStart={() => void startScan()}
            onPause={() => void scanControl("pause")}
            onResume={() => void scanControl("resume")}
            onStop={() => void scanControl("stop")}
            onExport={exportExcel}
            exportCount={stats?.condition_passed_products ?? 0}
          />

          <Separator />

          {/* 판매량 지표를 얻는 방법 안내 */}
          <div className="space-y-1.5 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <ShoppingCart className="h-3.5 w-3.5 text-primary" />
              판매량 지표
            </div>
            <ol className="ml-3.5 list-decimal space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              <li>
                <b className="text-[var(--success)]">한 달 구매 (1순위)</b> — 쿠팡이 상품 페이지에
                표시하는 &quot;한 달간 N명 이상 구매했어요&quot; 문구입니다. 추정치가 아니라
                <b> 쿠팡의 실제 판매 데이터</b>이며, 수집만 하면 바로 채워집니다.
              </li>
              <li>
                <b className="text-foreground">최근 30일 예상 판매량 (보조)</b> — 구매 문구가 없는
                상품용입니다. 리뷰수 변화를 추적하거나 리뷰 작성일을 분석해 추정합니다.
              </li>
            </ol>
            {stats && stats.unique_products > 0 && stats.purchase_labeled_products === 0 && (
              <p className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2 text-[11px] leading-relaxed text-[var(--warning)]">
                수집한 상품 중 &quot;한 달간 N명 구매&quot; 문구가 확보된 상품이 없습니다.
                목록 페이지에 문구가 없다면 상품 상세 페이지에서 수집해 보세요.
              </p>
            )}
          </div>

        </aside>

        {/* 오른쪽 75% */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3">
          <KpiCards stats={stats} hasConditions={hasConditions} />

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="상품명 검색"
                className="pl-7"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>

            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="정렬" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={onlyPassed ? "default" : "outline"}
              size="sm"
              className="h-8"
              disabled={!hasConditions || onlyPending}
              title={hasConditions ? undefined : "왼쪽에서 상품 조건을 먼저 설정하세요"}
              onClick={() => setOnlyPassed((v) => !v)}
            >
              조건 통과만
            </Button>

            <Button
              variant={onlyPending ? "default" : "outline"}
              size="sm"
              className="h-8"
              disabled={!hasConditions}
              title="1차 조건은 통과했지만 쿠팡 구매 문구를 아직 확인하지 못한 상품"
              onClick={() => setOnlyPending((v) => !v)}
            >
              상세 확인 필요
              {stats && stats.purchase_pending_products > 0 && (
                <span className="ml-1 rounded bg-[var(--warning)]/20 px-1 text-[10px] text-[var(--warning)]">
                  {stats.purchase_pending_products}
                </span>
              )}
            </Button>

            {onlyPending && products.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="h-8"
                title="상위 10개 상품 상세 페이지를 새 탭으로 엽니다. 확장의 '자동 수집'을 켜두면 클릭 없이 저장됩니다."
                onClick={() => {
                  products
                    .slice(0, 10)
                    .forEach((p) => window.open(p.product_url, "_blank", "noopener"));
                }}
              >
                상위 10개 열기
              </Button>
            )}
          </div>

          <ProductTable
            products={products}
            loading={loading}
            total={total}
            hasConditions={hasConditions}
          />
        </main>
      </div>
    </div>
  );
}
