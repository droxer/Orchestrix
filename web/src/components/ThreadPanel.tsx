import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ActionAddPerson, ActionSearch } from "./icons";
import { ConversationRow, type EmployeeContact } from "./ConversationRow";

// Conversation/people list: search-to-connect plus the list of employee
// contacts. Selecting or connecting routes through the host callbacks.
export function ThreadPanel({ employees, employeeQuery, setEmployeeQuery, selectedEmployee, onSelectEmployee, onRemoveEmployee }: {
  employees: EmployeeContact[];
  employeeQuery: string;
  setEmployeeQuery: Dispatch<SetStateAction<string>>;
  selectedEmployee: string;
  onSelectEmployee: (id: string) => void;
  onRemoveEmployee: (id: string) => void;
}) {
  const { t } = useTranslation();
  const connect = () => {
    const q = employeeQuery.trim().replace(/^@/, "");
    if (q) { onSelectEmployee(q); setEmployeeQuery(""); }
  };

  return (
    <aside className="thread-panel" aria-label={t("nav.conversations")}>
      <div className="conversation-header">
        <div className="conversation-heading">
          <h1>{t("thread.messages")}<small className="mono conversation-heading-count">{employees.length.toString().padStart(2, "0")}</small></h1>
        </div>
      </div>
      <form className="people-search conversation-search" onSubmit={(e) => { e.preventDefault(); connect(); }}>
        <ActionSearch size={16} />
        <input aria-label={t("thread.search_label")} name="employee-search" autoComplete="off" spellCheck={false} placeholder={t("thread.search_placeholder")} value={employeeQuery} onChange={(e) => setEmployeeQuery(e.target.value)} />
        {employeeQuery.trim() ? (
          <button type="submit" className="search-connect-btn" aria-label={t("thread.connect_to", { name: employeeQuery.trim().replace(/^@/, "") })} title={t("thread.connect_hint")}>
            <ActionAddPerson size={13} />
          </button>
        ) : null}
      </form>
      <section className="conversation-list" aria-label={t("nav.conversations")}>
        {employees.map((c) => <ConversationRow key={c.id} contact={c} selected={selectedEmployee === c.id} onSelect={(id) => onSelectEmployee(id)} onRemove={onRemoveEmployee} />)}
        {employees.length === 0 && !employeeQuery.trim() ? (
          <p className="conversation-empty">{t("thread.no_nodes")}</p>
        ) : null}
        {employees.length === 0 && employeeQuery.trim() ? (
          <button
            className="conversation-row conversation-connect-hint"
            type="button"
            onClick={connect}
          >
            <span className="connect-hint-icon" aria-hidden="true"><ActionAddPerson size={14} /></span>
            <span className="conversation-copy">
              <span className="conversation-name"><strong translate="no">@{employeeQuery.trim().replace(/^@/, "")}</strong></span>
              <span className="conversation-preview">{t("thread.connect_hint")}</span>
            </span>
          </button>
        ) : null}
      </section>
    </aside>
  );
}
