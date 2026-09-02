"use client";

import * as React from "react";
import { AlertCircle, CalendarClock, Play, RefreshCw, Search } from "lucide-react";

import { CategoryTree } from "@/components/dashboard/category-tree";
import { ConditionPanel } from "@/components/dashboard/condition-panel";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MultiplierPanel } from "@/components/dashboard/multiplier-panel";
import { ProductTable } from "@/components/dashboard/product-table";
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
      const listQuery = buildQuery(conditions, selectedIds, {
        sort,
        q: debouncedKeyword || undefined,
        page_size: 200,
        condition_passed: onlyPassed ? true : undefined,
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
  }, [conditions, selectedIds, sort, debouncedKeyword, onlyPassed, reloadKey]);

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

  /** 수집 시작: job을 만들고, 선택한 카테고리 페이지를 새 탭으로 연다.
   *  실제 상품 수집은 Chrome 확장 프로그램이 담당한다. */
  const startCollection = async () => {
    setError(null);
    try {
      const res = await api.startJob(selectedIds);
      const urls = res.target_urls;
      urls.slice(0, 10).forEach((url) => window.open(url, "_blank", "noopener"));
      setNotice(
        urls.length === 0
          ? `수집 작업 #${res.job.id} 시작됨. 열 수 있는 카테고리 URL이 없습니다 — Chrome에서 쿠팡 페이지를 직접 열고 확장 프로그램으로 수집하세요.`
          : `수집 작업 #${res.job.id} 시작됨. 카테고리 ${Math.min(urls.length, 10)}개 탭을 열었습니다. 각 탭에서 확장 프로그램의 [현재 페이지 수집]을 눌러주세요.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "수집을 시작하지 못했습니다.");
    }
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
          <div className="space-y-1.5">
            <Button className="w-full" onClick={() => void startCollection()}>
              <Play /> 수집 시작
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              선택한 카테고리 페이지를 새 탭으로 엽니다. 각 탭에서 Chrome 확장 프로그램의
              [현재 페이지 수집]을 눌러 현재 화면에 노출된 상품을 수집하세요.
            </p>
          </div>

          <Separator />

          {/* 최근 30일 지표를 얻는 방법 안내 — 쿠팡이 제공하지 않는 값이라 설명이 필요하다 */}
          <div className="space-y-1.5 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              최근 30일 지표
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              쿠팡은 최근 1달 리뷰수를 표시하지 않습니다. 두 가지 방법으로 구합니다.
            </p>
            <ol className="ml-3.5 list-decimal space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              <li>
                <b className="text-foreground">리뷰 날짜 분석</b> — 상품 상세 페이지에서 리뷰를
                <b> 최신순</b>으로 정렬하고 더보기로 충분히 불러온 뒤, 확장의
                [리뷰 날짜 분석]을 누르면 바로 실측됩니다.
              </li>
              <li>
                <b className="text-foreground">리뷰수 변화 추적</b> — 같은 목록을 며칠 간격으로 다시
                수집하면 누적 리뷰수의 차이로 자동 계산됩니다. 전체 상품에 적용되지만 시간이 필요합니다.
              </li>
            </ol>
            {stats && stats.unique_products > 0 && stats.monthly_measured_products === 0 && (
              <p className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2 text-[11px] leading-relaxed text-[var(--warning)]">
                아직 최근 30일 지표가 측정된 상품이 없습니다. 위 두 방법 중 하나를 먼저 진행하세요.
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
              disabled={!hasConditions}
              title={hasConditions ? undefined : "왼쪽에서 상품 조건을 먼저 설정하세요"}
              onClick={() => setOnlyPassed((v) => !v)}
            >
              조건 통과만
            </Button>
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
