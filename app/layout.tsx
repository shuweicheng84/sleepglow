import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "见微 · SleepGlow",
  description:
    "在每天清晨的一瞬，轻盈地感知自己眼周的元气微光，全部计算都只存在于你的设备中。"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    // 就是这里加了 suppressHydrationWarning，专治各种浏览器插件引发的报错
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <style type="text/tailwindcss">{`
          .glass-panel {
            @apply bg-white/60 border border-white/70 backdrop-blur-md;
          }
        `}</style>
      </head>
      <body className="min-h-screen bg-stone-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
