/**
 * Popup UI.
 *   - 현재 페이지 감지 결과 표시 ("쿠팡 상품 36개 감지")
 *   - [현재 페이지 수집] 버튼
 *   - 수집 결과 표시 ("36개 중 35개 저장 / 중복 1개")
 */
import { DEFAULT_API_BASE, getApiBase, setApiBase } from "@/lib/api";
import type {
  CollectResponse,
  MonthlyReviewResponse,
  ParseResult,
  ReviewDateResult,
} from "@/lib/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const detectCount = $<HTMLElement>("detect-count");
const detectSub = $<HTMLElement>("detect-sub");
const detectMeta = $<HTMLElement>("detect-meta");
const collectButton = $<HTMLButtonElement>("collect");
const rescanButton = $<HTMLButtonElement>("rescan");
const resultPanel = $<HTMLElement>("result");
const resultMain = $<HTMLElement>("result-main");
const resultSub = $<HTMLElement>("result-sub");
const errorPanel = $<HTMLElement>("error");
const reviewPanel = $<HTMLElement>("review-panel");
const analyzeButton = $<HTMLButtonElement>("analyze-reviews");
const resetButton = $<HTMLButtonElement>("reset-reviews");
const reviewProgress = $<HTMLElement>("review-progress");
const reviewResult = $<HTMLElement>("review-result");
const apiBaseInput = $<HTMLInputElement>("api-base");
const saveApiButton = $<HTMLButtonElement>("save-api");

const PAGE_TYPE_LABEL: Record<string, string> = {
  category: "카테고리 페이지",
  search: "검색결과 페이지",
  list: "상품 목록 페이지",
  product: "상품 상세 페이지",
  unknown: "알 수 없는 페이지",
};

function showError(message: string) {
  errorPanel.textContent = message;
  errorPanel.classList.remove("hidden");
}

function clearError() {
  errorPanel.textContent = "";
  errorPanel.classList.add("hidden");
}

function renderScan(result: ParseResult) {
  const detected = result.products.length;
  detectCount.textContent = `쿠팡 상품 ${detected}개 감지`;
  detectSub.textContent = result.skipped > 0 ? `(제외 ${result.skipped}개)` : "";

  const lines = [PAGE_TYPE_LABEL[result.pageType] ?? result.pageType];
  if (result.categoryName) lines.push(`카테고리: ${result.categoryName}`);
  if (result.categoryCode) lines.push(`코드: ${result.categoryCode}`);
  if (result.matchedCardSelector) lines.push(`selector: ${result.matchedCardSelector}`);
  detectMeta.textContent = lines.join(" · ");

  collectButton.disabled = detected === 0;

  // 최근 30일 리뷰 분석은 상품 상세 페이지에서만 의미가 있다.
  reviewPanel.classList.toggle("hidden", result.pageType !== "product");
  reviewResult.textContent = "";
  reviewProgress.textContent = "";

  if (detected === 0 && result.errors.length > 0) {
    showError(result.errors[0] ?? "상품을 찾지 못했습니다.");
  }
}

function renderCollect(response: CollectResponse, detected: number) {
  resultPanel.classList.remove("hidden");
  const parts = [`${detected}개 중 ${response.saved}개 저장`];
  if (response.duplicates > 0) parts.push(`중복 ${response.duplicates}개`);
  resultMain.textContent = parts.join(" · ");

  const sub = [`신규 ${response.inserted}개`, `갱신 ${response.updated}개`];
  if (response.skipped > 0) sub.push(`파싱 제외 ${response.skipped}개`);
  if (response.job_id !== null) sub.push(`작업 #${response.job_id}`);
  resultSub.textContent = sub.join(" / ");
}

const nf = new Intl.NumberFormat("ko-KR");

function renderReviewAnalysis(analysis: ReviewDateResult, result?: MonthlyReviewResponse) {
  let head = "";
  const lines: string[] = [];

  if (result && result.monthly_review_count !== null) {
    const label = result.monthly_review_is_extrapolated ? "추정" : "실측";
    head = `<span class="big">최근 30일 리뷰 ${nf.format(result.monthly_review_count)}건 (${label})</span>`;
    if (result.monthly_estimated_sales !== null) {
      lines.push(
        `최근 30일 예상 판매량 <b>${nf.format(result.monthly_estimated_sales)}</b> (실제 판매량 아님)`,
      );
    }
  }

  lines.push(
    `누적 리뷰 ${nf.format(analysis.sampleSize)}건` +
      (analysis.pagesSeen > 0 ? ` (${nf.format(analysis.pagesSeen)}페이지)` : "") +
      ` · 30일 이내 ${nf.format(analysis.reviewsInWindow)}건`,
  );
  if (analysis.newestReviewDate && analysis.oldestReviewDate) {
    lines.push(`표본 기간 ${analysis.oldestReviewDate} ~ ${analysis.newestReviewDate}`);
  }
  if (result?.message) lines.push(result.message);
  for (const warning of analysis.warnings) {
    lines.push(`<span class="warn">⚠ ${warning}</span>`);
  }

  reviewResult.innerHTML = head + lines.join("<br />");
}

async function resetReviews() {
  clearError();
  resetButton.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: "RESET_REVIEWS" });
    reviewResult.textContent = "";
    reviewProgress.textContent = "누적을 초기화했습니다. 리뷰 페이지를 다시 넘겨주세요.";
  } finally {
    resetButton.disabled = false;
  }
}

async function analyzeReviews() {
  clearError();
  analyzeButton.disabled = true;
  analyzeButton.textContent = "분석 중...";
  reviewResult.textContent = "";
  reviewProgress.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({ type: "ANALYZE_REVIEWS" });
    if (response?.analysis) {
      renderReviewAnalysis(response.analysis as ReviewDateResult, response.result);
    }
    if (!response?.ok) showError(response?.error ?? "리뷰 분석에 실패했습니다.");
  } finally {
    analyzeButton.textContent = "리뷰 날짜 분석";
    analyzeButton.disabled = false;
  }
}

async function scan() {
  clearError();
  resultPanel.classList.add("hidden");
  detectCount.textContent = "확인 중...";
  detectSub.textContent = "";
  detectMeta.textContent = "";
  collectButton.disabled = true;
  reviewPanel.classList.add("hidden");

  const response = await chrome.runtime.sendMessage({ type: "SCAN" });
  if (!response?.ok) {
    detectCount.textContent = "감지 실패";
    showError(response?.error ?? "알 수 없는 오류");
    return;
  }
  renderScan(response.result as ParseResult);
}

async function collect() {
  clearError();
  collectButton.disabled = true;
  collectButton.textContent = "수집 중...";
  try {
    const response = await chrome.runtime.sendMessage({ type: "COLLECT" });
    if (!response?.ok) {
      showError(response?.error ?? "수집에 실패했습니다.");
      return;
    }
    renderCollect(response.result as CollectResponse, response.detected as number);
  } finally {
    collectButton.textContent = "현재 페이지 수집";
    collectButton.disabled = false;
  }
}

collectButton.addEventListener("click", () => void collect());
rescanButton.addEventListener("click", () => void scan());
analyzeButton.addEventListener("click", () => void analyzeReviews());
resetButton.addEventListener("click", () => void resetReviews());
saveApiButton.addEventListener("click", () => {
  const value = apiBaseInput.value.trim() || DEFAULT_API_BASE;
  void setApiBase(value).then(() => {
    apiBaseInput.value = value;
    saveApiButton.textContent = "저장됨";
    setTimeout(() => (saveApiButton.textContent = "저장"), 1200);
  });
});

void getApiBase().then((base) => (apiBaseInput.value = base));
void scan();
