import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "쿠팡 상품 소싱 분석",
  description: "리뷰수 기반 예상 판매량으로 쿠팡 소싱 후보 상품을 찾습니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
