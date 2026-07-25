import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CollaborationTreeNode } from "../lib/collaborationTree";

export function SubagentTree({ nodes }: { nodes: CollaborationTreeNode[] }) {
  const { t } = useTranslation();
  if (nodes.length === 0) return null;
  return (
    <section className="collaboration-tree" aria-label={t("agent_stream.subagents_title")}>
      <div className="collaboration-tree-title">{t("agent_stream.subagents_title")}</div>
      <div className="collaboration-tree-roots">
        {nodes.map((node) => <SubagentNode key={node.threadId} node={node} />)}
      </div>
    </section>
  );
}

function SubagentNode({ node }: { node: CollaborationTreeNode }) {
  const { t } = useTranslation();
  const active = node.status === "pendingInit" || node.status === "running";
  const tone = node.status === "completed" || node.status === "shutdown"
    ? "good"
    : node.status === "errored" || node.status === "notFound"
      ? "bad"
      : node.status === "interrupted" ? "warn" : "info";
  // Open by default while the subagent is live, but once the user toggles the
  // node their choice wins — status changes must not reopen a collapsed node.
  const [open, setOpen] = useState(active);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (active && !userToggledRef.current) setOpen(true);
  }, [active]);
  return (
    <details
      className={`collaboration-node tone-${tone}`}
      open={open || undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary onClick={() => { userToggledRef.current = true; }}>
        <span className="collaboration-branch" aria-hidden="true" />
        <span className={`collaboration-status-dot tone-${tone}`} aria-hidden="true" />
        <span className="collaboration-label" title={node.prompt ?? undefined}>{node.label}</span>
        <span className="collaboration-status">{t(`agent_stream.subagent_status.${node.status}`)}</span>
      </summary>
      <div className="collaboration-node-body">
        {node.message ? <p>{node.message}</p> : null}
        {node.model ? (
          <span className="collaboration-meta">
            {node.model}{node.reasoningEffort ? ` · ${node.reasoningEffort}` : ""}
          </span>
        ) : null}
        {node.children.map((child) => <SubagentNode key={child.threadId} node={child} />)}
      </div>
    </details>
  );
}
