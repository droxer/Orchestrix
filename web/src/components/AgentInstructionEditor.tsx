"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActionEdit } from "./icons";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface AgentInstructionEditorProps {
  value: string;
  draft: string;
  editing: boolean;
  editable: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function AgentInstructionEditor({
  value,
  draft,
  editing,
  editable,
  saving,
  onStartEdit,
  onDraftChange,
  onCancel,
  onSave,
}: AgentInstructionEditorProps) {
  const { t } = useTranslation();
  const savedValue = value.trim();
  const draftValue = draft.trim();
  const dirty = draftValue !== savedValue;
  const hasCustomInstruction = savedValue.length > 0;
  const titleId = useId();
  const helpId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && window.matchMedia("(pointer: fine)").matches) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  function useStarter() {
    onDraftChange(t("agents_page.instructions_starter"));
  }

  return (
    <section
      className={`agent-instruction-card${editing ? " is-editing" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="agent-instruction-card-head">
        <div className="agent-instruction-card-heading">
          <div className="agent-instruction-card-title-row">
            <h2 id={titleId}>
              {t("agents_page.instructions_label")}
            </h2>
            <span className={`agent-instruction-state${hasCustomInstruction ? " is-custom" : ""}`}>
              {hasCustomInstruction
                ? t("agents_page.instructions_custom")
                : t("agents_page.instructions_default")}
            </span>
          </div>
          <span id={helpId} className="agent-instruction-card-help">
            {t("agents_page.instructions_help")}
          </span>
        </div>
        {editable && !editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="agent-instruction-edit-action"
            onClick={onStartEdit}
          >
            <ActionEdit size={13} aria-hidden="true" />
            {hasCustomInstruction
              ? t("agents_page.edit_instructions")
              : t("agents_page.add_instructions")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="agent-instruction-editor">
          <div className="agent-instruction-editor-toolbar">
            <span>{t("agents_page.instructions_editor_label")}</span>
            {!draftValue ? (
              <Button variant="ghost" type="button" className="h-auto" onClick={useStarter} disabled={saving}>
                {t("agents_page.instructions_starter_action")}
              </Button>
            ) : null}
          </div>
          <Textarea
            ref={textareaRef}
            className="agent-instruction-textarea mono"
            name="agent-instructions"
            aria-label={t("agents_page.instructions_label")}
            aria-describedby={helpId}
            rows={10}
            autoComplete="off"
            spellCheck
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && dirty) {
                event.preventDefault();
                onSave();
              }
              if (event.key === "Escape") onCancel();
            }}
            disabled={saving}
            placeholder={t("agents_page.instructions_placeholder")}
          />
          <div className="agent-instruction-editor-foot">
            <span className="agent-instruction-count mono">
              {t("agents_page.instructions_characters", { count: draft.length })}
            </span>
            <span className="agent-instruction-save-hint">
              {t("agents_page.instructions_save_hint")}
            </span>
            <div className="agent-instruction-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={saving}
              >
                {t("admin.v2.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={saving || !dirty}
              >
                {saving ? t("admin.v2.saving") : t("agents_page.save_instructions")}
              </Button>
            </div>
          </div>
        </div>
      ) : hasCustomInstruction ? (
        <p className="agent-instruction-prose">{savedValue}</p>
      ) : (
        <div className="agent-instruction-empty">
          <p>{t("agents_page.instructions_empty")}</p>
          <span>{t("agents_page.instructions_empty_help")}</span>
        </div>
      )}
    </section>
  );
}
