import type { Metadata, Viewport } from "next";
import { Noto_Sans_TC, Geist_Mono } from "next/font/google";
import "./globals.css";

const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CarePal 失智症照護助理",
  description: "台灣醫療場景語音照護介面示範（Web Demo）",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${notoSansTC.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full min-w-0 flex-col overflow-x-clip font-sans">
        {children}
      </body>
    </html>
  );
}
