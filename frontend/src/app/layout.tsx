import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Floorplan AI — 평면 · 동선 자동 생성기",
  description:
    "건물 외곽선과 복도 동선으로부터 세대를 자동 구획하고 피난 동선을 검증하는 인터랙티브 에디터",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
