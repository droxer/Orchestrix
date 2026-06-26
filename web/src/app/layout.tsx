import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Geist,
  Geist_Mono,
  Noto_Sans_SC,
  Noto_Sans_TC,
} from "next/font/google";

import "../styles.css";

import { Providers } from "./providers";

// Precision system — Geist handles every line of UI and display text at
// modern grotesque crispness; Geist Mono is the identity signal for
// eyebrows, metadata, agent labels, numbers, and code. The editorial
// serif is retired — display moments now use weighted Geist via the
// --font-display alias in tokens.css. latin-ext widens coverage to
// accented European/Vietnamese names in employee and sandbox labels.
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
// keeping Geist for Latin. preload is off — CJK has no single subset to
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
      className={`${geist.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansTC.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Set data-theme before first paint so system/dark users never
            flash the light canvas. Mirrors applyTheme() in appStorage.ts:
            resolve "system" via matchMedia, otherwise honor the pin. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('relay-web.theme')||'system';if(t==='contrast'){document.documentElement.setAttribute('data-theme','contrast');}else{var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
