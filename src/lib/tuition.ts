/**
 * 원비 계산 규정 — 2026 학원비 결제 및 환불 매뉴얼 기준.
 *
 * 정규반은 매달 일수와 상관없이 16일부터 다음 달 15일까지를 한 달로 본다.
 * (윈터는 주기가 다르지만 아직 다루지 않는다)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 월 원비별 일할 단가. 매뉴얼에 못 박힌 고정값이라 나누어 구하지 않는다. */
const DAILY_RATE: Record<number, number> = {
  680_000: 23_000,
  650_000: 22_000,
};

export const TIER_MONTHLY_FEE = {
  STANDARD: 680_000,
  EARLY: 650_000,
  RETURNING: 650_000,
  REENROLLED: 680_000,
} as const;

export type TuitionTier = keyof typeof TIER_MONTHLY_FEE;

export function dailyRateFor(monthlyFee: number): number {
  return DAILY_RATE[monthlyFee] ?? Math.round(monthlyFee / 30);
}

/** 규정에 없는 금액이면 일할 단가를 확신할 수 없으므로 호출부에서 알린다. */
export function hasFixedDailyRate(monthlyFee: number): boolean {
  return monthlyFee in DAILY_RATE;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((+to - +from) / DAY_MS);
}

export function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export type ChargeResult = {
  amount: number;
  proratedDays: number | null;
  dailyRate: number | null;
};

/**
 * 한 주기의 청구액을 구한다.
 *
 * 일할계산은 첫 달에만 적용한다. 등원일이 주기 안에 있으면 그 주기가 첫 달이므로
 * 첫등원일부터 주기 종료일(15일)까지를 일할로 계산하고, 그 전에 등원했으면 전액이다.
 * 등원일 당일도 하루로 세므로 15일 첫 등원생은 하루치가 나온다.
 */
export function chargeForPeriod(
  enrolledAt: Date,
  periodStart: Date,
  periodEnd: Date,
  monthlyFee: number,
): ChargeResult | null {
  if (enrolledAt > periodEnd) return null;
  if (enrolledAt <= periodStart) {
    return { amount: monthlyFee, proratedDays: null, dailyRate: null };
  }

  const days = daysBetween(enrolledAt, periodEnd) + 1;
  const dailyRate = dailyRateFor(monthlyFee);
  return { amount: dailyRate * days, proratedDays: days, dailyRate };
}

export type RefundTier = 'FULL' | 'TWO_THIRDS' | 'HALF' | 'NONE';

export const REFUND_LABEL: Record<RefundTier, string> = {
  FULL: '전액 환불',
  TWO_THIRDS: '2/3 환불',
  HALF: '1/2 환불',
  NONE: '환불 없음',
};

export type RefundStatus = {
  tier: RefundTier;
  label: string;
  effectiveStart: Date;
  totalDays: number;
  elapsedDays: number | null;
  twoThirdsUntil: Date;
  halfUntil: Date;
};

/**
 * 환불 가능 시점을 구한다. 금액은 계산하지 않는다 — 실제 환불 여부와 금액은
 * 감염병 사유 등 사람의 판단이 들어가므로 원장이 정한다.
 *
 * 학원의 설립·운영 및 과외교습에 관한 법률 18조 3항:
 *   교습 시작 전 전액, 1/3 경과 전 2/3, 1/2 경과 전 1/2, 그 후 없음.
 * 출결 횟수가 아니라 날짜로 판정하며, 통보한 날까지 등원한 것으로 본다.
 *
 * 경과 비율의 기준이 되는 교습 기간은 주기 전체가 아니라
 * **첫등원일부터 주기 종료일까지**, 즉 그 학생이 실제로 계약한 기간이다.
 * 매뉴얼의 8월 표 961개 경우와 대조해 확인했다.
 */
export function refundStatus(
  enrolledAt: Date,
  periodStart: Date,
  periodEnd: Date,
  noticeDate: Date | null,
): RefundStatus {
  const effectiveStart = enrolledAt > periodStart ? enrolledAt : periodStart;
  const totalDays = daysBetween(effectiveStart, periodEnd) + 1;

  const twoThirdsDays = Math.floor(totalDays / 3);
  const halfDays = Math.floor(totalDays / 2);

  const base = {
    effectiveStart,
    totalDays,
    twoThirdsUntil: addDays(effectiveStart, twoThirdsDays - 1),
    halfUntil: addDays(effectiveStart, halfDays - 1),
  };

  if (!noticeDate) {
    return { ...base, tier: 'FULL', label: REFUND_LABEL.FULL, elapsedDays: null };
  }

  if (noticeDate < effectiveStart) {
    return { ...base, tier: 'FULL', label: REFUND_LABEL.FULL, elapsedDays: 0 };
  }

  const elapsedDays = daysBetween(effectiveStart, noticeDate) + 1;
  const tier: RefundTier =
    elapsedDays <= twoThirdsDays ? 'TWO_THIRDS' : elapsedDays <= halfDays ? 'HALF' : 'NONE';

  return { ...base, tier, label: REFUND_LABEL[tier], elapsedDays };
}
