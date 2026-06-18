import type { Tone } from "../types";

type EmployeeAvatarProps = {
  employeeId: string;
  running: boolean;
  tone?: Tone;
  size?: number;
};

export function EmployeeAvatar({ employeeId, running, tone, size }: EmployeeAvatarProps) {
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
  return (
    <span className={classes} style={style} aria-hidden="true">
      {initials}
    </span>
  );
}
