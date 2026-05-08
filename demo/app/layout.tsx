import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "traumatrial — real-time trauma trial eligibility",
  description:
    "Open infrastructure for matching trauma bay patients to active clinical trials in real time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        <div
          role="note"
          className="sticky top-0 z-50 w-full bg-amber-900/90 text-amber-50 text-xs sm:text-sm text-center px-3 py-1.5 border-b border-amber-700/60 backdrop-blur"
        >
          <span className="font-semibold">DEMO</span> — not a clinical decision system, not validated, no real patient data.
        </div>
        {children}
      </body>
    </html>
  );
}
