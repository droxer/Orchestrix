import { CircleStop, KeyRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { StatusPill } from "./StatusPill";
import type { DaemonNodeMonitorRecord, SandboxRecord } from "../types";
import { conversationDaemonStatus } from "../lib/conversationStatus";

export type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  registeredEmployees: string[];
  selectedEmployee: string;
  selectEmployee: (employeeId: string) => Promise<void>;
  tokenInput: string;
  setTokenInput: (value: string) => void;
  saveToken: () => void;
  selectedSandbox?: SandboxRecord;
  selectedNode?: DaemonNodeMonitorRecord;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
  onCancelRun: () => Promise<void>;
};

export function SettingsDrawer({
  open,
  onClose,
  registeredEmployees,
  selectedEmployee,
  selectEmployee,
  tokenInput,
  setTokenInput,
  saveToken,
  selectedSandbox,
  selectedNode,
  activeRun,
  onCancelRun,
}: SettingsDrawerProps) {
  const { t } = useTranslation();
  if (!open) return null;
  const daemonStatus = conversationDaemonStatus({
    node: selectedNode,
    sandbox: selectedSandbox,
    activeRun,
  });
  const selectedEmployeeLabel = selectedEmployee ? `@${selectedEmployee}` : t("thread.no_employee_selected");
  return (
    <aside id="settings-drawer" className="settings-drawer" aria-labelledby="settings-title">
      <div className="settings-header">
        <div>
          <p className="eyebrow">{t("settings.employee_workspace")}</p>
          <h3 id="settings-title" translate={selectedEmployee ? "no" : undefined}>
            {selectedEmployeeLabel}
          </h3>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("settings.close")} onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      <section className="settings-section">
        <div className="panel-kicker">{t("settings.registered_nodes")}</div>
        <div className="settings-user-list">
          {registeredEmployees.map((employeeId) => (
            <button
              className={`settings-user ${selectedEmployee === employeeId ? "active" : ""}`}
              key={employeeId}
              onClick={() => void selectEmployee(employeeId)}
              type="button"
            >
              <EmployeeAvatar employeeId={employeeId} running={false} />
              <span translate="no">@{employeeId}</span>
            </button>
          ))}
          {registeredEmployees.length === 0 ? <p className="settings-hint">{t("settings.no_nodes")}</p> : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">{t("settings.sandbox_token")}</div>
        <div className="settings-inline">
          <KeyRound size={15} />
          <Input
            aria-label={t("settings.sandbox_token")}
            name="sandbox-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="tok_…"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          <Button size="sm" type="button" onClick={saveToken}>
            {t("settings.save_token")}
          </Button>
        </div>
        <p className="settings-hint">{t("settings.token_hint")}</p>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">{t("settings.live_sandbox")}</div>
        <p className="settings-id" translate="no">
          {selectedSandbox?.id ?? t("settings.no_sandbox")}
        </p>
        <StatusPill value={daemonStatus} />
        <dl className="settings-dl">
          <div>
            <dt>{t("settings.workspace_label")}</dt>
            <dd>{selectedSandbox?.workspacePath ?? "none"}</dd>
          </div>
          <div>
            <dt>{t("settings.node_label")}</dt>
            <dd>
              {selectedNode ? (
                <>
                  <span className="mono">{selectedNode.queuedCommandCount}</span> {t("settings.queued")}
                </>
              ) : (
                t("settings.not_registered")
              )}
            </dd>
          </div>
          <div>
            <dt>{t("settings.run_label")}</dt>
            <dd>
              {activeRun ? (
                <span className="settings-run">
                  <span className="mono" translate="no">
                    {activeRun.agent}
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="settings-cancel"
                    onClick={() => void onCancelRun()}
                  >
                    <CircleStop size={12} /> {t("settings.cancel")}
                  </Button>
                </span>
              ) : (
                t("settings.idle")
              )}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
