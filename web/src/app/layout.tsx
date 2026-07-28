import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "../styles.css";

import { Providers } from "./providers";

// Phosphor typography: one mono family carries both the display tier and
// technical text, and Geist stays quieter for dense UI and body copy. Display
// vs. technical is separated by weight, tracking, and colour rather than by
// face — 700 tight-tracked in --ink-1 for titles, names, and metrics; 400
// untracked in --ink-4 for session IDs, logs, and code. Both are local
// variable fonts to avoid layout drift.
//
// The vendored WOFF2 is fontsource's latin subset of JetBrains Mono
// (@fontsource-variable/jetbrains-mono 5.3.0, OFL-1.1, wght 100–800). Latin
// covers U+00C0–00FF, so accented names render in-face; latin-ext glyphs fall
// through to Geist by design rather than shipping a second file.
//
// CJK stays system-first (PingFang / YaHei / etc. in palette.css). We do
// not load Noto Sans SC/TC through next/font — those unicode-range chunks
// balloon Turbopack compile and only matter on bare Linux.
const appSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-app-sans",
  display: "swap",
  weight: "100 900",
  style: "normal",
});

const appMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-app-mono",
  display: "swap",
  weight: "100 800",
  style: "normal",
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
};

const themeScript = `(function(){try{
  var t=localStorage.getItem("relay-web.theme")||"system";
  if(t==="contrast"||t==="contrast-dark"){t="system";localStorage.setItem("relay-web.theme","system");}
  var d=matchMedia("(prefers-color-scheme: dark)").matches;
  var r=(t==="dark"||(t!=="light"&&d))?"dark":"light";
  var root=document.documentElement;
  root.setAttribute("data-theme",r);
  var sync=function(){
    var color=getComputedStyle(root).getPropertyValue("--surface-0").trim();
    if(!color)return false;
    var meta=document.querySelector('meta[name="theme-color"][data-relay-theme-color]');
    if(!meta){
      meta=document.createElement("meta");
      meta.setAttribute("name","theme-color");
      meta.setAttribute("data-relay-theme-color","");
      document.head.appendChild(meta);
    }
    meta.removeAttribute("media");
    meta.setAttribute("content",color);
    return true;
  };
  if(!sync())document.addEventListener("DOMContentLoaded",sync,{once:true});
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // The default language is English; the client App updates both
  // document.documentElement.lang and document.title from the user's
  // saved preference once it hydrates.
  return (
    <html
      lang="en"
      className={`${appMono.variable} ${appSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Resolve the saved theme before first paint, then derive browser
            chrome from the same canvas token as the rendered page. */}
        <script
          dangerouslySetInnerHTML={{
            __html: themeScript,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
