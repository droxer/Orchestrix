"use client";

import type { ReactNode } from "react";

interface KpiTileProps {
  eyebrow: string;
  value: ReactNode;
  hero?: boolean;
  slot?: "sessions" | "nodes" | "employees" | "tokens";
  delta?: {
    label: string;
    direction: "up" | "down" | "flat";
  };
  hint?: string;
}

export function KpiTile({ eyebrow, value, hero, slot, delta, hint }: KpiTileProps) {
  const hasFoot = Boolean(delta || hint);
  const slotClass = slot ? ` adm-dash-tile--${slot}` : "";
  return (
    <div
      className={`adm-dash-tile${hero ? " adm-dash-tile--hero" : ""}${slotClass}`}
    >
      <div className="adm-dash-tile-eyebrow">{eyebrow}</div>
      <div className="adm-dash-tile-value tnum">{value}</div>
      {hasFoot ? (
        <div className="adm-dash-tile-foot">
          {/* A trend direction is not a status tone: "went up" carries no hue
              of its own, and spelling it `tone-up` put it in a vocabulary whose
              every other member promises one. Keyed on a data attribute. */}
          {delta ? (
            <span className="adm-dash-delta" data-direction={delta.direction}>
              <span className="adm-dash-delta-glyph" aria-hidden="true">
                {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—"}
              </span>
              <span>{delta.label}</span>
            </span>
          ) : hint ? (
            <span className="adm-dash-tile-hint">{hint}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
