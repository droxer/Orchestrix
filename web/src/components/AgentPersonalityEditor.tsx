"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ActionEdit } from "./icons";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface AgentPersonalityEditorProps {
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

export function AgentPersonalityEditor({
  value,
  draft,
  editing,
  editable,
  saving,
  onStartEdit,
  onDraftChange,
  onCancel,
  onSave,
}: AgentPersonalityEditorProps) {
  const { t } = useTranslation();
  const savedValue = value.trim();
  const draftValue = draft.trim();
  const dirty = draftValue !== savedValue;
  const hasCustomPersonality = savedValue.length > 0;
  const titleId = useId();
  const helpId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && window.matchMedia("(pointer: fine)").matches) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  function useStarter() {
    onDraftChange(t("agents_page.personality_starter"));
  }

  return (
    <section
      className={`agent-personality-card${editing ? " is-editing" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="agent-personality-card-head">
        <div className="agent-personality-heading">
          <span className="agent-personality-file" aria-hidden="true">PERSONALITY</span>
          <div className="agent-personality-title-block">
            <div className="agent-personality-title-row">
              <h2 id={titleId}>{t("agents_page.personality_title")}</h2>
              <span className={`agent-personality-state${hasCustomPersonality ? " is-defined" : ""}`}>
                <span aria-hidden="true" />
                {hasCustomPersonality
                  ? t("agents_page.personality_defined")
                  : t("agents_page.personality_default")}
              </span>
            </div>
            <span id={helpId} className="agent-personality-help">
              {t("agents_page.personality_help")}
            </span>
          </div>
        </div>
        {editable && !editing ? (
          <Button
            type="button"
            variant={hasCustomPersonality ? "outline" : "default"}
            size="sm"
            className="agent-personality-edit-action"
            onClick={onStartEdit}
          >
            <ActionEdit size={13} aria-hidden="true" />
            {hasCustomPersonality
              ? t("agents_page.edit_personality")
              : t("agents_page.write_personality")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="agent-personality-editor">
          <div className="agent-personality-editor-guide">
            <p>{t("agents_page.personality_editor_intro")}</p>
            <ol aria-label={t("agents_page.personality_framework")}>
              <li>
                <span>01</span>
                <div>
                  <strong>{t("agents_page.personality_purpose")}</strong>
                  <small>{t("agents_page.personality_purpose_help")}</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>{t("agents_page.personality_truths")}</strong>
                  <small>{t("agents_page.personality_truths_help")}</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>{t("agents_page.personality_voice")}</strong>
                  <small>{t("agents_page.personality_voice_help")}</small>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>{t("agents_page.personality_boundaries")}</strong>
                  <small>{t("agents_page.personality_boundaries_help")}</small>
                </div>
              </li>
            </ol>
          </div>
          <div className="agent-personality-editor-toolbar">
            <span>{t("agents_page.personality_editor_label")}</span>
            {!draftValue ? (
              <Button variant="ghost" type="button" className="h-auto" onClick={useStarter} disabled={saving}>
                {t("agents_page.personality_starter_action")}
              </Button>
            ) : null}
          </div>
          <Textarea
            ref={textareaRef}
            className="agent-personality-textarea mono"
            name="agent-personality"
            aria-label={t("agents_page.personality_title")}
            aria-describedby={helpId}
            rows={14}
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
            placeholder={t("agents_page.personality_placeholder")}
          />
          <div className="agent-personality-editor-foot">
            <span className="agent-personality-count mono">
              {t("agents_page.personality_characters", { count: draft.length })}
            </span>
            <span className="agent-personality-save-hint">
              {t("agents_page.personality_save_hint")}
            </span>
            <div className="agent-personality-actions">
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
                {saving ? t("admin.v2.saving") : t("agents_page.save_personality")}
              </Button>
            </div>
          </div>
        </div>
      ) : hasCustomPersonality ? (
        <article className="agent-personality-document">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedValue}</ReactMarkdown>
        </article>
      ) : (
        <div className="agent-personality-empty">
          <p className="agent-personality-empty-lede">{t("agents_page.personality_empty")}</p>
          <span>{t("agents_page.personality_empty_help")}</span>
          <ol aria-label={t("agents_page.personality_framework")}>
            <li>
              <span>01</span>
              <strong>{t("agents_page.personality_purpose")}</strong>
            </li>
            <li>
              <span>02</span>
              <strong>{t("agents_page.personality_truths")}</strong>
            </li>
            <li>
              <span>03</span>
              <strong>{t("agents_page.personality_voice")}</strong>
            </li>
            <li>
              <span>04</span>
              <strong>{t("agents_page.personality_boundaries")}</strong>
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}
