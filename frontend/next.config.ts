import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16은 dev 리소스에 대한 cross-origin 접근을 기본 차단한다.
  // localhost / 127.0.0.1 어느 쪽으로 열어도 HMR이 동작하도록 허용한다.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
