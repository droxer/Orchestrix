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

// One crisp precision grotesk carries display, chrome, AND body text —
// the monochrome system differentiates with weight and tracking, never a
// family switch. This one variable Geist instance backs both --font-sans
// and --font-display in tokens/primitives.css (both alias --font-app-sans).
// Geist Mono is reserved for code-like content: tool/command lines, raw
// logs, code blocks, and IDs. latin-ext widens coverage to accented
// European/Vietnamese names in employee and sandbox labels.
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#010102" },
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
        {/* Set data-theme before first paint so dark/system users never
            flash the light canvas. Mirrors applyTheme() in appStorage.ts:
            dark is the default/primary theme; "system" resolves via
            matchMedia, otherwise honor the pin. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('relay-web.theme')||'dark';if(t==='contrast'||t==='contrast-dark'){t='system';localStorage.setItem('relay-web.theme','system');}var d=matchMedia('(prefers-color-scheme: dark)').matches;var dk=t==='dark'||(t!=='light'&&d);var r=dk?'dark':'light';document.documentElement.setAttribute('data-theme',r);document.documentElement.classList.toggle('dark',dk);var c={light:'#ffffff',dark:'#010102'}[r]||'#010102';var m=document.querySelector('meta[name=\"theme-color\"][data-relay-theme-color]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');m.setAttribute('data-relay-theme-color','');document.head.appendChild(m);}m.removeAttribute('media');m.setAttribute('content',c);}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
