import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "../styles.css";

import { Providers } from "./providers";

// Editorial Serif system — Instrument Serif carries display moments with
// a confident editorial voice; Geist handles every line of UI text at
// modern grotesque crispness; Geist Mono renders numbers and code with
// the same designer's hand. Three families, one designer's intent.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  weight: "variable",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  weight: "variable",
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
    <html lang="en" className={`${instrumentSerif.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
