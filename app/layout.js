import "./globals.css";

export const metadata = {
  title: "Agent 心理诊所 — 给你的 AI 做一次全面体检",
  description:
    "Agent 心理诊所是一个开放平台，由 AI 诊断师通过对话检测你的 Agent 的安全性、注入抵抗力和行为倾向。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Serif+SC:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#faf8f5] text-gray-800 antialiased">{children}</body>
    </html>
  );
}
