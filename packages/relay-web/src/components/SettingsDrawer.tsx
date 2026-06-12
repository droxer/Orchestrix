import { CircleStop, KeyRound, UserRound, X } from "lucide-react";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { StatusPill } from "./StatusPill";
import type { DaemonNodeMonitorRecord, SandboxRecord } from "../types";

export type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  quickUsers: string[];
  selectedEmployee: string;
  customEmployee: string;
  setCustomEmployee: (value: string) => void;
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
  quickUsers,
  selectedEmployee,
  customEmployee,
  setCustomEmployee,
  selectEmployee,
  tokenInput,
  setTokenInput,
  saveToken,
  selectedSandbox,
  selectedNode,
  activeRun,
  onCancelRun,
}: SettingsDrawerProps) {
  if (!open) return null;
  return (
    <aside id="settings-drawer" className="settings-drawer" aria-labelledby="settings-title">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Employee workspace</p>
          <h3 id="settings-title" translate="no">
            @{selectedEmployee}
          </h3>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <section className="settings-section">
        <div className="panel-kicker">Known employees</div>
        <div className="settings-user-list">
          {quickUsers.map((employeeId) => (
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
        </div>
        <form
          className="settings-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void selectEmployee(customEmployee);
            setCustomEmployee("");
          }}
        >
          <UserRound size={15} />
          <input
            aria-label="Custom employee ID"
            name="custom-employee-id"
            autoComplete="off"
            spellCheck={false}
            placeholder="alice…"
            value={customEmployee}
            onChange={(event) => setCustomEmployee(event.target.value)}
          />
          <button type="submit">Open Employee</button>
        </form>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">Sandbox token</div>
        <div className="settings-inline">
          <KeyRound size={15} />
          <input
            aria-label="Sandbox token"
            name="sandbox-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="tok_…"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          <button type="button" onClick={saveToken}>
            Save Token
          </button>
        </div>
        <p className="settings-hint">Saved locally in this browser for the selected employee.</p>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">Live sandbox</div>
        <p className="settings-id" translate="no">
          {selectedSandbox?.id ?? "No sandbox selected"}
        </p>
        <StatusPill value={selectedSandbox?.status ?? "provisioning"} />
        <dl className="settings-dl">
          <div>
            <dt>workspace</dt>
            <dd>{selectedSandbox?.workspacePath ?? "none"}</dd>
          </div>
          <div>
            <dt>node</dt>
            <dd>
              {selectedNode ? (
                <>
                  <span className="mono">{selectedNode.queuedCommandCount}</span> queued
                </>
              ) : (
                "not registered"
              )}
            </dd>
          </div>
          <div>
            <dt>run</dt>
            <dd>
              {activeRun ? (
                <span className="settings-run">
                  <span className="mono" translate="no">
                    {activeRun.agent}
                  </span>
                  <button
                    type="button"
                    className="settings-cancel"
                    onClick={() => void onCancelRun()}
                  >
                    <CircleStop size={12} /> Cancel
                  </button>
                </span>
              ) : (
                "idle"
              )}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
