import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import "../styles.css";

import { Providers } from "./providers";

// One crisp precision grotesk carries display, chrome, AND body text —
// the graphite system differentiates with weight and tracking, never a
// family switch. This one variable Geist instance backs --font-sans in
// tokens/palette.css (via --font-app-sans). Geist Mono is reserved for
// code-like content: tool/command lines, raw logs, code blocks, and IDs.
// latin-ext widens coverage to accented European/Vietnamese names in
// employee and sandbox labels.
//
// CJK stays system-first (PingFang / YaHei / etc. in palette.css). We do
// not load Noto Sans SC/TC through next/font — those unicode-range chunks
// balloon Turbopack compile and only matter on bare Linux.
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

export const metadata: Metadata = {
  title: "Relay",
  description: "Nodes, daemons, and agent runs.",
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
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#101214" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // The default language is English; the client App updates both
  // document.documentElement.lang and document.title from the user's
  // saved preference once it hydrates.
  return (
    <html
      lang="en"
      className={`${appSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Set data-theme before first paint so dark/system users never
            flash the light canvas. Mirrors applyTheme() in appStorage.ts:
            "system" is the default and resolves via matchMedia, otherwise
            honor the pin. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('relay-web.theme')||'system';if(t==='contrast'||t==='contrast-dark'){t='system';localStorage.setItem('relay-web.theme','system');}var d=matchMedia('(prefers-color-scheme: dark)').matches;var dk=t==='dark'||(t!=='light'&&d);var r=dk?'dark':'light';document.documentElement.setAttribute('data-theme',r);document.documentElement.classList.toggle('dark',dk);var c={light:'#f7f8f9',dark:'#101214'}[r]||'#101214';var m=document.querySelector('meta[name=\"theme-color\"][data-relay-theme-color]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');m.setAttribute('data-relay-theme-color','');document.head.appendChild(m);}m.removeAttribute('media');m.setAttribute('content',c);}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
