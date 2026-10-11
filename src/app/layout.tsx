import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "liteshop",
    template: "%s · liteshop",
  },
  description: "数字商品自动售卖",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={
        "h-full antialiased " +
        geistSans.variable +
        " " +
        geistMono.variable +
        " " +
        instrumentSerif.variable
      }
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
