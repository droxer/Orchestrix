import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "../styles.css";

import { InlineScript } from "../components/InlineScript";
import { Providers } from "./providers";

// Fieldnotes typography: IBM Plex Sans carries every role — reading, control,
// and display — with hierarchy built from weight (400/500/600/700) rather
// than face. JetBrains Mono remains for technical text only: session IDs,
// logs, and code, set 400 untracked (DESIGN.md names it a near-perfect
// substitute for Source Code Pro at body sizes). Both are local variable
// fonts to avoid layout drift.
//
// The vendored WOFF2 is fontsource's latin subset of IBM Plex Sans
// (@fontsource-variable/ibm-plex-sans 5.3.0, OFL-1.1, wght 100–700). Latin
// covers U+00C0–00FF, so accented names render in-face; latin-ext glyphs fall
// through to the system sans by design rather than shipping a second file.
// The same arrangement holds for JetBrains Mono (fontsource 5.3.0, OFL-1.1,
// wght 100–800).
//
// CJK stays system-first (PingFang / YaHei / etc. in palette.css). We do
// not load Noto Sans SC/TC through next/font — those unicode-range chunks
// balloon Turbopack compile and only matter on bare Linux.
const appSans = localFont({
  src: "./fonts/IBMPlexSans-Variable.woff2",
  variable: "--font-app-sans",
  display: "swap",
  weight: "100 700",
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
        <InlineScript html={themeScript} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
