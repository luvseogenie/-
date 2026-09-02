/** 확장 프로그램 공통 로거. 수집 실패 원인을 콘솔에 남긴다(개발 원칙 18). */
const PREFIX = "[쿠팡 소싱 수집기]";

export const log = {
  info: (...args: unknown[]) => console.info(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};
