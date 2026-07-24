import { useTranslation } from "react-i18next";
import type { Tone } from "../types";

type EmployeeAvatarProps = {
  employeeId: string;
  running: boolean;
  tone?: Tone;
  size?: number;
  /** Pass the display name when the avatar stands alone (no adjacent visible
      name): it becomes role="img" with an accessible name that includes the
      live running state. Omit when a visible name sits next to the avatar —
      the avatar then stays aria-hidden decoration. */
  name?: string;
};

export function EmployeeAvatar({ employeeId, running, tone, size, name }: EmployeeAvatarProps) {
  const { t } = useTranslation();
  const initials =
    employeeId
      .split(/[._\-\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  const style = size
    ? ({ "--avatar-size": `${size}px` } as React.CSSProperties)
    : undefined;
  const classes = [
    "employee-avatar",
    running ? "running" : "",
    tone ? `tone-${tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const accessibility = name
    ? {
        role: "img" as const,
        "aria-label": running ? `${name} · ${t("status.running")}` : name,
      }
    : { "aria-hidden": "true" as const };
  return (
    <span className={classes} style={style} {...accessibility}>
      {initials}
    </span>
  );
}
