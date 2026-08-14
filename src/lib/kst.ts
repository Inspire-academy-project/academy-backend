/**
 * 학원은 한국 시간으로 돌아가지만 서버는 UTC로 뜬다.
 * 밤 10시에 찍은 하원이 다음 날짜로 넘어가지 않도록 여기서만 시차를 다룬다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 한국 날짜 기준 오늘.
 * date 컬럼은 UTC 자정으로 저장하므로 parseDateOnly 와 같은 형태로 돌려준다.
 */
export function kstToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(`${shifted.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** 08:52 처럼 한국 시각의 시·분만 돌려준다. */
export function formatKstTime(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);
}
