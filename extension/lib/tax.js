// 종합소득세 추정 (근로소득 + 쿠팡 사업소득). 쿠팡 소득의 세금 = (근로+사업 세금) − (근로만 있을 때 세금) 증분 방식.
// ※ 추정치입니다. 실제 신고는 세무사/홈택스 기준으로 확인하세요. 건강보험료(소득월액보험료)는 포함하지 않습니다.

// 과세표준 구간 [상한, 세율, 누진공제]. 2023년 귀속분부터 적용되는 표 (그 이전 연도는 옛 표).
export const BRACKETS_2023 = [[14000000, 0.06, 0], [50000000, 0.15, 1260000], [88000000, 0.24, 5760000], [150000000, 0.35, 15440000], [300000000, 0.38, 19940000], [500000000, 0.40, 25940000], [1000000000, 0.42, 35940000], [Infinity, 0.45, 65940000]];
export const BRACKETS_OLD = [[12000000, 0.06, 0], [46000000, 0.15, 1080000], [88000000, 0.24, 5220000], [150000000, 0.35, 14900000], [300000000, 0.38, 19400000], [500000000, 0.40, 25400000], [1000000000, 0.42, 35400000], [Infinity, 0.45, 65400000]];
export const bracketsFor = (year) => (year >= 2023 ? BRACKETS_2023 : BRACKETS_OLD);

export function incomeTax(base, year) {
  if (base <= 0) return 0;
  for (const [cap, rate, deduct] of bracketsFor(year)) if (base <= cap) return Math.max(0, base * rate - deduct);
  return 0;
}
export function marginalRate(base, year) { for (const [cap, rate] of bracketsFor(year)) if (base <= cap) return rate; return 0.45; }

// 근로소득공제 (총급여 → 공제액)
export function earnedIncomeDeduction(salary) {
  if (salary <= 0) return 0;
  if (salary <= 5000000) return salary * 0.7;
  if (salary <= 15000000) return 3500000 + (salary - 5000000) * 0.4;
  if (salary <= 45000000) return 7500000 + (salary - 15000000) * 0.15;
  if (salary <= 100000000) return 12000000 + (salary - 45000000) * 0.05;
  return Math.min(20000000, 14750000 + (salary - 100000000) * 0.02); // 공제 한도 2천만원
}
// 근로소득세액공제 (근로소득에 해당하는 산출세액 기준, 총급여별 한도)
export function earnedIncomeTaxCredit(taxOnEarned, salary) {
  if (salary <= 0 || taxOnEarned <= 0) return 0;
  const raw = taxOnEarned <= 1300000 ? taxOnEarned * 0.55 : 715000 + (taxOnEarned - 1300000) * 0.3;
  let limit;
  if (salary <= 33000000) limit = 740000;
  else if (salary <= 70000000) limit = Math.max(660000, 740000 - (salary - 33000000) * 0.008);
  else if (salary <= 120000000) limit = Math.max(500000, 660000 - (salary - 70000000) * 0.5);
  else limit = Math.max(200000, 500000 - (salary - 120000000) * 0.5);
  return Math.min(raw, limit);
}

export const DEFAULT_TAX_SETTINGS = {
  salary: 120000000,      // 근로소득 총급여(연)
  reliefRate: 50,         // 청년창업중소기업 세액감면율 (%)
  deductions: 1500000,    // 소득공제 합계 (기본공제 본인 150만 등)
  otherCredits: 0,        // 기타 세액공제 (표준세액공제 등)
  extraExpenses: 0,       // 장부에 없는 사업 경비(연) — 사업소득금액에서 뺌
  localTax: true,         // 지방소득세 10%
};

/** 한 해의 세금 계산. bizIncome = 쿠팡 순이익(연). */
export function computeYearTax(year, bizIncome, s = DEFAULT_TAX_SETTINGS) {
  const st = { ...DEFAULT_TAX_SETTINGS, ...s };
  const earned = Math.max(0, st.salary - earnedIncomeDeduction(st.salary));   // 근로소득금액
  const biz = Math.max(0, bizIncome - (st.extraExpenses || 0));               // 사업소득금액 (손실이면 0으로 취급)
  const calc = (withBiz) => {
    const total = earned + (withBiz ? biz : 0);
    const base = Math.max(0, total - st.deductions);
    const gross = incomeTax(base, year);
    const taxOnEarned = total ? gross * (earned / total) : 0;
    const taxOnBiz = total ? gross * ((withBiz ? biz : 0) / total) : 0;
    const earnedCredit = earnedIncomeTaxCredit(taxOnEarned, st.salary);
    let relief = withBiz ? taxOnBiz * (st.reliefRate / 100) : 0;
    // 개인 최저한세: 감면 후 사업소득 세액 ≥ 감면 전 사업소득 산출세액 × 35%(3천만 이하) / 45%(초과)
    const minRate = taxOnBiz > 30000000 ? 0.45 : 0.35;
    if (withBiz && taxOnBiz - relief < taxOnBiz * minRate) relief = taxOnBiz * (1 - minRate);
    const determined = Math.max(0, gross - earnedCredit - relief - (st.otherCredits || 0));
    const local = st.localTax ? determined * 0.1 : 0;
    return { total, base, gross, taxOnEarned, taxOnBiz, earnedCredit, relief, determined, local, all: determined + local, marginal: marginalRate(base, year) };
  };
  const withBiz = calc(true), salaryOnly = calc(false);
  const bizTax = Math.max(0, withBiz.all - salaryOnly.all);
  // 실제 적용된 감면 비율 (최저한세로 깎였으면 그 값)
  const reliefApplied = withBiz.taxOnBiz > 0 ? withBiz.relief / withBiz.taxOnBiz : Math.min(st.reliefRate / 100, 0.65);
  return {
    year, bizIncome, earned, biz, withBiz, salaryOnly, bizTax, reliefApplied,
    effectiveRate: biz > 0 ? bizTax / biz : 0,
    netAfterTax: bizIncome - bizTax,
    marginalEffective: withBiz.marginal * (1 - reliefApplied) * (st.localTax ? 1.1 : 1),
  };
}

/** 월별 배분: 누적 순이익 기준으로 그 달까지의 세금 − 전달까지의 세금 */
export function monthlyBreakdown(year, monthlyProfit, s) {
  const out = []; let cum = 0, prevTax = 0;
  for (let m = 1; m <= 12; m++) {
    const p = monthlyProfit[m] || 0; if (!(m in monthlyProfit)) { out.push({ month: m, profit: 0, cum, tax: 0, net: 0, empty: true }); continue; }
    cum += p; const t = computeYearTax(year, cum, s).bizTax; const tax = t - prevTax; prevTax = t;
    out.push({ month: m, profit: p, cum, tax, net: p - tax, rate: p ? tax / p : 0 });
  }
  return out;
}
