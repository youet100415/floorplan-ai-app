/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 홈 디렉터리에 다른 package-lock.json 이 있으면 Next 가 워크스페이스 루트를
  // 거기로 추론해 파일 추적 범위가 홈 전체로 번진다. 이 폴더로 못박는다.
  outputFileTracingRoot: import.meta.dirname,
  env: {
    // 백엔드 주소. 배포 시 NEXT_PUBLIC_API_BASE 로 덮어쓴다.
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000",
  },
};

export default nextConfig;
