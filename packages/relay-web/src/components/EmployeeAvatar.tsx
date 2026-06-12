type EmployeeAvatarProps = {
  employeeId: string;
  running: boolean;
};

export function EmployeeAvatar({ employeeId, running }: EmployeeAvatarProps) {
  const initials =
    employeeId
      .split(/[._\-\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  return (
    <span className={`employee-avatar ${running ? "running" : ""}`} aria-hidden="true">
      {initials}
    </span>
  );
}
