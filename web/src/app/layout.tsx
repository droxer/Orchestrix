import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import {
  Geist,
  Geist_Mono,
  Noto_Sans_SC,
  Noto_Sans_TC,
} from "next/font/google";

import "../styles.css";

import { Providers } from "./providers";

// Unified Geist superfamily — Geist Sans carries UI, display, and chrome
// text (eyebrows, metadata, agent labels, numbers) per the Linear model.
// Geist Mono is reserved for code-like content: tool/command lines, raw
// logs, code blocks, and IDs. One harmonized family keeps the two cuts in
// register. latin-ext widens coverage to accented European/Vietnamese
// names in employee and sandbox labels.
const appSans = Geist({
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

// CJK fallback for the zh-CN / zh-TW locales. The :lang() stacks in
// tokens.css are system-first (PingFang, HarmonyOS Sans, YaHei…), so
// Noto Sans SC/TC only download when a Han glyph misses every system
// font (e.g. bare Linux). preload is off — CJK has no single subset to
// preload — so the unicode-range chunks stay untouched until needed.
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfcfa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0a" },
  ],
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
              "(function(){try{var t=localStorage.getItem('relay-web.theme')||'system';var d=matchMedia('(prefers-color-scheme: dark)').matches;var r;if(t==='contrast'||t==='contrast-dark'){r=t;}else{var dk=t==='dark'||(t!=='light'&&d);r=dk?'dark':'light';}document.documentElement.setAttribute('data-theme',r);var c={light:'#fdfcfa',dark:'#0d0c0a',contrast:'#ffffff','contrast-dark':'#000000'}[r]||'#fdfcfa';var m=document.querySelector('meta[name=\"theme-color\"][data-relay-theme-color]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');m.setAttribute('data-relay-theme-color','');document.head.appendChild(m);}m.removeAttribute('media');m.setAttribute('content',c);}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
