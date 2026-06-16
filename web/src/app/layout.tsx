import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Geist,
  Geist_Mono,
  Instrument_Serif,
  Noto_Sans_SC,
  Noto_Sans_TC,
} from "next/font/google";

import "../styles.css";

import { Providers } from "./providers";

// Editorial Serif system — Instrument Serif carries display moments with
// a confident editorial voice; Geist handles every line of UI text at
// modern grotesque crispness; Geist Mono renders numbers and code with
// the same designer's hand. Three families, one designer's intent.
// latin-ext widens coverage to accented European/Vietnamese names that
// appear in employee and sandbox labels.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin", "latin-ext"],
  variable: "--font-instrument-serif",
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
});

const geist = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist",
  display: "swap",
  weight: "variable",
});

const geistMono = Geist_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-mono",
  display: "swap",
  weight: "variable",
});

// CJK coverage for the zh-CN / zh-TW locales. The Latin families above
// ship no Han glyphs, so under a Chinese locale the :lang() rules in
// tokens.css fall through to Noto Sans SC/TC for Han characters while
// keeping Geist/Instrument Serif for Latin. preload is off — CJK has no
// single subset to preload — so these only download on a Chinese locale.
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  display: "swap",
  weight: ["400", "500", "600"],
  preload: false,
});

const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-sans-tc",
  display: "swap",
  weight: ["400", "500", "600"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Relay — Workforce Control Plane",
  description: "Coordinate Claude, Pi, and Codex Inside Employee Sandboxes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // The default language is English; the client App updates both
  // document.documentElement.lang and document.title from the user's
  // saved preference once it hydrates.
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${geist.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansTC.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
