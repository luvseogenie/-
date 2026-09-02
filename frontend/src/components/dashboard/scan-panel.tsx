"use client";

import { ClipboardCopy, Download, Pause, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DETAIL_LIMIT_OPTIONS, PAGES_OPTIONS, type ScanStatus } from "@/lib/types";

const STATUS_LABEL: Record<ScanStatus["status"], string> = {
  running: "수집 중",
  paused: "일시정지",
  completed: "완료",
  stopped: "중단됨",
};

/**
 * 자동 스캔 제어 패널.
 *
 * [소싱 시작] 한 번으로 선택한 카테고리(하위 포함)의 목록 페이지와
 * 1차 조건을 통과한 상품의 상세 페이지를 확장 프로그램이 순서대로 방문한다.
 * 사용자는 페이지를 직접 클릭하지 않는다.
 */
export function ScanPanel({
  selectedCount,
  pages,
  detailLimit,
  status,
  starting,
  onPagesChange,
  onDetailLimitChange,
  onStart,
  onPause,
  onResume,
  onStop,
  onExport,
  exportCount,
  extensionConnected,
  onReport,
}: {
  selectedCount: number;
  pages: number;
  detailLimit: number;
  status: ScanStatus | null;
  starting: boolean;
  onPagesChange: (pages: number) => void;
  onDetailLimitChange: (limit: number) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onExport: () => void;
  exportCount: number;
  /** 서버 상태·최근 로그·최근 스캔 결과를 글로 복사 (원격에서 원인을 잡기 위한 보고서) */
  onReport: () => void;
  /** 크롬 확장이 이 페이지에 연결되어 있는지 (null = 아직 확인 중) */
  extensionConnected: boolean | null;
}) {
  const active = status?.status === "running" || status?.status === "paused";
  const percent = status && status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Play className="h-3.5 w-3.5 text-primary" />
          실행
        </div>
        <span
          className={`text-[10px] ${
            extensionConnected ? "text-[var(--success)]" : extensionConnected === false ? "text-destructive" : "text-muted-foreground"
          }`}
          title="크롬 확장 프로그램이 이 페이지에 연결되어 있으면 [소싱 시작]만으로 자동 수집이 돌아갑니다"
        >
          {extensionConnected ? "● 확장 연결됨" : extensionConnected === false ? "● 확장 미감지" : "확장 확인 중"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>카테고리당 페이지</Label>
          <Select value={String(pages)} onValueChange={(v) => onPagesChange(Number(v))}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGES_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}페이지 ({n * 120}개)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>상세 확인 상품 수</Label>
          <Select value={String(detailLimit)} onValueChange={(v) => onDetailLimitChange(Number(v))}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DETAIL_LIMIT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  상위 {n}개
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        체크한 카테고리와 그 아래 전부를 판매량순으로 훑습니다. 페이지 좌측 메뉴에서 새 하위
        카테고리를 발견하면 트리와 대상에 자동으로 추가됩니다. 상세 확인은 1차 조건을 통과한
        상품 중 리뷰가 많은 순으로 진행되며, 여기서 &quot;한 달간 N명 구매&quot;와 30일 리뷰수를
        얻습니다.
      </p>

      {!active ? (
        <Button
          className="w-full"
          disabled={selectedCount === 0 || starting}
          onClick={onStart}
          title={selectedCount === 0 ? "왼쪽에서 카테고리를 먼저 선택하세요" : undefined}
        >
          <Play /> 소싱 시작 {selectedCount > 0 && `(${selectedCount}개 카테고리)`}
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-primary">
              {STATUS_LABEL[status!.status]} · {status!.phase === "list" ? "1단계 목록" : "2단계 상세"}
            </span>
            <span className="tabular text-muted-foreground">
              {status!.done}/{status!.total}
              {status!.failed > 0 && ` · 실패 ${status!.failed}`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            <span>목록 {status!.list.done}/{status!.list.total}</span>
            <span>상세 {status!.detail.done}/{status!.detail.total}</span>
          </div>
          {status!.current_label && (
            <p className="truncate text-[10px] text-muted-foreground" title={status!.current_label}>
              현재: {status!.current_label}
            </p>
          )}
          <div className="flex gap-1">
            {status!.status === "running" ? (
              <Button size="sm" variant="outline" className="h-7 flex-1" onClick={onPause}>
                <Pause /> 일시정지
              </Button>
            ) : (
              <Button size="sm" variant="default" className="h-7 flex-1" onClick={onResume}>
                <Play /> 재개
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={onStop}>
              <Square /> 중단
            </Button>
          </div>
          {status!.last_done_label && (
            <p className="truncate text-[10px] text-muted-foreground" title={status!.last_done_label}>
              방금: {status!.last_done_label}
              {status!.last_product_count !== null && ` — 상품 ${status!.last_product_count}개`}
            </p>
          )}
          {!extensionConnected && (
            <p className="text-[10px] leading-relaxed text-destructive">
              확장이 연결되지 않아 자동으로 시작하지 못했습니다. 크롬 확장 popup에서 <b>[자동 수집 시작]</b>을 누르세요.
            </p>
          )}
        </div>
      )}

      {status && status.recent_errors.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
          <div className="font-semibold">최근 실패 사유</div>
          {status.recent_errors.map((e, i) => (
            <p key={i} className="leading-snug" title={e.error}>
              [{e.kind === "list" ? "목록" : "상세"}] {e.label}
              <br />
              <span className="opacity-80">{e.error}</span>
            </p>
          ))}
        </div>
      )}

      {status?.status === "completed" && (
        <p className="rounded-md border border-[var(--success)]/40 bg-[var(--success)]/10 p-2 text-[11px] text-[var(--success)]">
          수집 완료 — 목록 {status.list.done}페이지, 상세 {status.detail.done}건.
          {status.failed > 0 && ` 실패 ${status.failed}건.`}
        </p>
      )}

      <Button
        variant="secondary"
        className="w-full"
        onClick={onExport}
        disabled={exportCount === 0}
        title="현재 조건을 통과한 상품을 엑셀에서 열리는 파일로 저장합니다"
      >
        <Download /> 엑셀로 내려받기 {exportCount > 0 && `(${exportCount}건)`}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-full text-[11px] text-muted-foreground"
        onClick={onReport}
        title="뭔가 안 될 때: 서버 기록·최근 수집 결과를 복사해 그대로 붙여넣어 보내주세요"
      >
        <ClipboardCopy /> 문제 보고서 복사
      </Button>
    </div>
  );
}
