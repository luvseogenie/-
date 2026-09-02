import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "쿠팡 상품 소싱 분석",
  description: "리뷰수 기반 예상 판매량으로 쿠팡 소싱 후보 상품을 찾습니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: 다른 크롬 확장이 <html>/<body>에 속성을 끼워 넣으면
    // (예: ap-style="") React 가 hydration 경고를 낸다. 기능과 무관하므로 무시한다.
    <html lang="ko" className="dark" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
