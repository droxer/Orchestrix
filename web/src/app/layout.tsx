import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Geist_Mono,
  Instrument_Sans,
  Noto_Sans_SC,
  Noto_Sans_TC,
} from "next/font/google";

import "../styles.css";

import { Providers } from "./providers";

// Warm precision system — Instrument Sans carries UI and display text
// with humanist warmth; Geist Mono stays as the identity signal for
// eyebrows, metadata, agent labels, numbers, and code. latin-ext widens
// coverage to accented European/Vietnamese names in employee and
// sandbox labels.
const appSans = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-app-sans",
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
// keeping Instrument Sans for Latin. preload is off — CJK has no single subset to
// preload — so these only download on a Chinese locale.
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
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/relay-mark.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/brand/relay-mark.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // The default language is English; the client App updates both
  // document.documentElement.lang and document.title from the user's
  // saved preference once it hydrates.
  return (
    <html
      lang="en"
      className={`${appSans.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansTC.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Set data-theme before first paint so system/dark users never
            flash the light canvas. Mirrors applyTheme() in appStorage.ts:
            resolve "system" via matchMedia, otherwise honor the pin. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('relay-web.theme')||'system';var d=matchMedia('(prefers-color-scheme: dark)').matches;if(t==='contrast'||t==='contrast-dark'){document.documentElement.setAttribute('data-theme',t);}else{var dk=t==='dark'||(t!=='light'&&d);document.documentElement.setAttribute('data-theme',dk?'dark':'light');}}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
