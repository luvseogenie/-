"use client";

import * as React from "react";
import { AlertCircle, Bookmark, RefreshCw, Search, ShoppingCart, Star } from "lucide-react";

import { CategoryTree } from "@/components/dashboard/category-tree";
import { ConditionPanel } from "@/components/dashboard/condition-panel";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MultiplierPanel } from "@/components/dashboard/multiplier-panel";
import { ProductTable } from "@/components/dashboard/product-table";
import { SavedPanel } from "@/components/dashboard/saved-panel";
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
import { formatNumber } from "@/lib/format";
import { extensionId, sendToExtension } from "@/lib/extension-bridge";
import {
  DEFAULT_CONDITIONS,
  SORT_OPTIONS,
  type CategoryTreeNode,
  type Conditions,
  type Product,
  type ScanStatus,
  type Stats,
  type SavedProduct,
} from "@/lib/types";

export default function DashboardPage() {
  const [tree, setTree] = React.useState<CategoryTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = React.useState(true);
  const [treeError, setTreeError] = React.useState<string | null>(null);

  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [conditions, setConditions] = React.useState<Conditions>(DEFAULT_CONDITIONS);
  const [multiplier, setMultiplier] = React.useState(20);
  const [savingMultiplier, setSavingMultiplier] = React.useState(false);

  /**
   * 결과 보기 범위. 조건을 설정하면 기본은 "조건 통과"만 보인다.
   *   passed  = 조건 통과   all = 전체   failed = 미달
   *   pending = 1차 조건은 통과했지만 최근 30일 리뷰수를 아직 못 잰 상품 (2단계 대기)
   */
  const [view, setView] = React.useState<"passed" | "all" | "failed" | "pending">("passed");

  /** 자동 스캔 설정·상태 */
  const [scanPages, setScanPages] = React.useState(1);
  const [scanDetailLimit, setScanDetailLimit] = React.useState(30);
  const [scanStatus, setScanStatus] = React.useState<ScanStatus | null>(null);
  const [scanStarting, setScanStarting] = React.useState(false);
  const [sort, setSort] = React.useState<string>("monthly_revenue_desc");
  const [keyword, setKeyword] = React.useState("");
  const [debouncedKeyword, setDebouncedKeyword] = React.useState("");

  const [products, setProducts] = React.useState<Product[]>([]);
  const [total, setTotal] = React.useState(0);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  /** 결과 범위: 이번 검색([소싱 시작] 마지막 실행)에서 훑은 상품만 / 누적 전체 */
  const [scope, setScope] = React.useState<"latest" | "all">("latest");
  /** 오른쪽 화면: 결과 표 / 보관함 */
  const [mainTab, setMainTab] = React.useState<"results" | "saved">("results");
  const [savedItems, setSavedItems] = React.useState<SavedProduct[]>([]);
  const [savedLoading, setSavedLoading] = React.useState(false);
  const [version, setVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (!cancelled && h.version) setVersion(h.version);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSaved = React.useCallback(async () => {
    setSavedLoading(true);
    try {
      setSavedItems(await api.saved());
    } catch (e) {
      setError(e instanceof Error ? e.message : "보관함을 불러오지 못했습니다.");
    } finally {
      setSavedLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    api
      .saved()
      .then((items) => {
        if (!cancelled) setSavedItems(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** ☆ 보관함 넣기/빼기 */
  const toggleSave = async (product: Product) => {
    setError(null);
    try {
      if (product.saved) await api.unsaveProduct(product.id);
      else await api.saveProducts([product.id], scanStatus?.job_id ?? null);
      setReloadKey((k) => k + 1);
      void loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "보관함 처리에 실패했습니다.");
    }
  };

  /** 문제 보고서: 서버 진단 + 스캔 상태 + 브라우저 정보를 글로 복사 */
  const copyReport = async () => {
    setError(null);
    try {
      const diag = await api.diagnostics();
      const report = [
        "=== 쿠팡 소싱 분석 문제 보고서 ===",
        `시각: ${new Date().toISOString()}`,
        `확장 연결: ${extensionConnected === null ? "확인 중" : extensionConnected ? "연결됨" : "미감지"}`,
        `브라우저: ${typeof navigator !== "undefined" ? navigator.userAgent : "-"}`,
        `조건: ${JSON.stringify(conditions)}`,
        `선택 카테고리 id: ${JSON.stringify(selectedIds)} · 페이지 ${scanPages} · 상세 ${scanDetailLimit}`,
        `스캔 상태: ${JSON.stringify(scanStatus)}`,
        "",
        JSON.stringify(diag, null, 1),
      ].join("\n");
      await navigator.clipboard.writeText(report);
      setNotice("문제 보고서를 복사했습니다. 채팅창에 붙여넣기(Ctrl+V)해서 보내주세요.");
    } catch (e) {
      setError(e instanceof Error ? `보고서 복사 실패: ${e.message}` : "보고서 복사 실패");
    }
  };

  /** 지금 표에 보이는 통과 상품을 한 번에 보관 */
  const savePassed = async () => {
    setError(null);
    const passed = products.filter((p) => p.condition_passed);
    const ids = passed.filter((p) => !p.saved).map((p) => p.id);
    const already = passed.length - ids.length;
    if (ids.length === 0) {
      setNotice(`보관할 새 통과 상품이 없습니다 (이미 보관된 ${already}건).`);
      return;
    }
    try {
      const res = await api.saveProducts(ids, scanStatus?.job_id ?? null);
      setNotice(`보관함에 ${res.added}건 추가 (이미 있던 ${res.skipped + already}건 제외) · 보관함 ${res.total}건`);
      setReloadKey((k) => k + 1);
      void loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "보관함 처리에 실패했습니다.");
    }
  };

  // 카테고리 트리 + 설정 최초 로드
  const [treeReloadKey, setTreeReloadKey] = React.useState(0);
  /** 크롬 확장이 이 페이지에 연결되어 있는지 (null = 확인 중) */
  const [extensionConnected, setExtensionConnected] = React.useState<boolean | null>(null);
  const [importingCategories, setImportingCategories] = React.useState(false);

  // 확장의 content script 는 페이지가 뜬 뒤에 붙으므로 몇 초 동안 다시 확인한다.
  React.useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const probe = () => {
      if (cancelled) return;
      const found = extensionId() !== null;
      tries += 1;
      if (found) setExtensionConnected(true);
      else if (tries >= 8) setExtensionConnected(false);
      if (!found && tries < 8) setTimeout(probe, 500);
      else if (found) setTimeout(probe, 10000); // 연결이 끊기는지도 가끔 본다
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 확장을 통해 쿠팡 첫 화면 메뉴에서 전체 카테고리를 가져온다 (popup 불필요). */
  const importCategories = async () => {
    setError(null);
    setImportingCategories(true);
    try {
      const res = await sendToExtension("IMPORT_CATEGORIES", 90000);
      if (!res.ok) {
        setError(res.error ?? "카테고리를 가져오지 못했습니다.");
        return;
      }
      const n = (v: unknown) => Number(v ?? 0).toLocaleString("ko-KR");
      setNotice(
        `카테고리 ${n(res.received)}개 등록 (신규 ${n(res.created)} / 갱신 ${n(res.updated)}) · 최상위 ${n(res.roots)}개 · 깊이 ${n(res.maxDepth)}단계`,
      );
      setTreeReloadKey((k) => k + 1);
    } finally {
      setImportingCategories(false);
    }
  };

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

  const [selectedIds, setSelectedIds] = React.useState<number[]>([]);
  const [prevSelected, setPrevSelected] = React.useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    setSelectedIds(Array.from(selected));
  }

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
      // 30일 미측정 상품을 볼 때는 30일·구매 문구 조건을 빼야 한다(아직 값이 없어 전부 탈락한다).
      const listConditions =
        view === "pending"
          ? {
              ...conditions,
              monthly_min: "",
              purchase_min: "",
              purchase_max: "",
              monthly_review_min: "",
              monthly_review_max: "",
              monthly_sales_min: "",
              monthly_sales_max: "",
            }
          : conditions;
      const listQuery = buildQuery(listConditions, selectedIds, {
        sort,
        q: debouncedKeyword || undefined,
        page_size: 200,
        condition_passed: view === "passed" || view === "pending" ? true : view === "failed" ? false : undefined,
        measured: view === "pending" ? false : undefined,
        scan: scope === "latest" ? "latest" : undefined,
      });
      const statsQuery = buildQuery(conditions, selectedIds, {
        q: debouncedKeyword || undefined,
        scan: scope === "latest" ? "latest" : undefined,
      });
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
  }, [conditions, selectedIds, sort, debouncedKeyword, view, scope, reloadKey]);

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

  // 조건을 처음 설정하면 "조건 통과" 탭으로, 조건이 모두 비면 "전체"로 옮긴다 (렌더 중 상태 보정).
  const [prevHasConditions, setPrevHasConditions] = React.useState(hasConditions);
  if (prevHasConditions !== hasConditions) {
    setPrevHasConditions(hasConditions);
    setView(hasConditions ? "passed" : "all");
  }

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
          monthly_min: toNumber(conditions.monthly_min),
          monthly_sales_min: toNumber(conditions.monthly_sales_min),
        },
      });
      // popup 을 열 필요 없이 확장을 바로 구동한다.
      const ext = await sendToExtension("SCAN_START");
      setScanStatus(await api.scanStatus());
      if (ext.ok) {
        setNotice(`목록 ${res.list_targets}페이지부터 자동 수집을 시작했습니다. 탭 하나가 열려 알아서 진행됩니다.`);
      } else {
        setNotice(`${res.message} (자동 시작 실패: ${ext.error ?? "확장 응답 없음"})`);
      }
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
      // 확장의 실행기도 같은 상태로 맞춘다 (없으면 조용히 넘어간다).
      void sendToExtension(action === "pause" ? "SCAN_PAUSE" : action === "resume" ? "SCAN_RESUME" : "SCAN_STOP", 10000);
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
      scan: scope === "latest" ? "latest" : undefined,
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
          <div className="mr-2 flex rounded-md border border-border p-0.5">
            <Button
              variant={mainTab === "results" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setMainTab("results")}
            >
              <Search /> 결과
            </Button>
            <Button
              variant={mainTab === "saved" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setMainTab("saved");
                void loadSaved();
              }}
            >
              <Bookmark /> 보관함 {savedItems.length > 0 && `(${savedItems.length})`}
            </Button>
          </div>
          {version && <span title="프로그램 버전 — 업데이트 후 바뀝니다">v{version}</span>}
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
            onImport={() => void importCategories()}
            importing={importingCategories}
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
            extensionConnected={extensionConnected}
            onReport={() => void copyReport()}
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

          {mainTab === "saved" ? (
            <SavedPanel
              items={savedItems}
              loading={savedLoading}
              onRefresh={() => void loadSaved()}
              onRemove={(item) => {
                void api
                  .removeSaved(item.id)
                  .then(() => {
                    setReloadKey((k) => k + 1);
                    void loadSaved();
                  })
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : "삭제 실패"));
              }}
              onMemo={(item, memo) => {
                void api
                  .updateSavedMemo(item.id, memo)
                  .then(() => void loadSaved())
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : "메모 저장 실패"));
              }}
              exportUrl={api.savedExportUrl()}
            />
          ) : (
            <>
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

            {(
              [
                ["passed", "조건 통과", stats?.condition_passed_products],
                ["all", "전체", stats?.unique_products],
                ["failed", "미달", stats ? stats.unique_products - stats.condition_passed_products : undefined],
                ["pending", "30일 미측정", stats?.monthly_pending_products],
              ] as const
            ).map(([key, label, count]) => (
              <Button
                key={key}
                variant={view === key ? "default" : "outline"}
                size="sm"
                className="h-8"
                disabled={!hasConditions && key !== "all"}
                title={
                  key === "pending"
                    ? "1차 조건(가격·리뷰·평점·배송)은 통과했지만 최근 30일 리뷰수를 아직 세지 않은 상품 — [소싱 시작]이 상세 페이지에서 채웁니다"
                    : !hasConditions
                      ? "왼쪽에서 상품 조건을 먼저 설정하세요"
                      : undefined
                }
                onClick={() => setView(key)}
              >
                {label}
                {hasConditions && count !== undefined && (
                  <span className="ml-1 rounded bg-foreground/10 px-1 text-[10px] tabular">{formatNumber(count)}</span>
                )}
              </Button>
            ))}

            <div className="ml-auto flex items-center gap-1">
              <div className="flex rounded-md border border-border p-0.5" title="이번 검색 = 마지막 [소싱 시작]에서 훑은 상품만">
                <Button variant={scope === "latest" ? "default" : "ghost"} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setScope("latest")}>
                  이번 검색
                </Button>
                <Button variant={scope === "all" ? "default" : "ghost"} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setScope("all")}>
                  누적 전체
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!hasConditions || view !== "passed" || products.length === 0}
                title="지금 표에 보이는 조건 통과 상품을 모두 보관함에 넣습니다"
                onClick={() => void savePassed()}
              >
                <Star /> 통과 상품 보관
              </Button>
            </div>
          </div>

          <ProductTable
            products={products}
            loading={loading}
            total={total}
            hasConditions={hasConditions}
            onToggleSave={(p) => void toggleSave(p)}
            breakdown={stats?.condition_breakdown ?? null}
            passedView={view === "passed"}
          />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
