"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActionEdit } from "./icons";
import { Markdown } from "./Markdown";
import { TonePill } from "./StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface AgentProfileEditorProps {
  name: string;
  nameDraft: string;
  personality: string;
  personalityDraft: string;
  editing: boolean;
  editable: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onNameDraftChange: (value: string) => void;
  onPersonalityDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function AgentProfileEditor({
  name,
  nameDraft,
  personality,
  personalityDraft,
  editing,
  editable,
  saving,
  onStartEdit,
  onNameDraftChange,
  onPersonalityDraftChange,
  onCancel,
  onSave,
}: AgentProfileEditorProps) {
  const { t } = useTranslation();
  const savedPersonality = personality.trim();
  const draftPersonality = personalityDraft.trim();
  const nameChanged = nameDraft.trim() !== name.trim();
  const personalityChanged = draftPersonality !== savedPersonality;
  const dirty = nameChanged || personalityChanged;
  const canSave = dirty && nameDraft.trim().length > 0;
  const hasCustomPersonality = savedPersonality.length > 0;
  const titleId = useId();
  const helpId = useId();
  const nameFieldId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && window.matchMedia("(pointer: fine)").matches) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  function useStarter() {
    onPersonalityDraftChange(t("agents_page.personality_starter"));
  }

  return (
    <section
      className={`agent-personality-card${editing ? " is-editing" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="agent-personality-card-head">
        <div className="agent-personality-title-block">
          <div className="agent-personality-title-row">
            <h2 id={titleId}>{t("agents_page.personality_title")}</h2>
            <TonePill
              tone={hasCustomPersonality ? "good" : "neutral"}
              label={hasCustomPersonality
                ? t("agents_page.personality_defined")
                : t("agents_page.personality_default")}
            />
          </div>
          <span id={helpId} className="agent-personality-help">
            {t("agents_page.personality_help")}
          </span>
        </div>
        {editable && !editing ? (
          <Button
            type="button"
            // Always the quiet outline tier — the amber default made a
            // secondary record action the loudest thing on the profile page.
            variant="outline"
            size="sm"
            className="agent-personality-edit-action"
            onClick={onStartEdit}
          >
            <ActionEdit size={13} aria-hidden="true" />
            {hasCustomPersonality
              ? t("agents_page.edit_profile")
              : t("agents_page.write_profile")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="agent-personality-editor">
          <div className="agent-profile-name-field">
            <label className="workspace-dossier-field-label" htmlFor={nameFieldId}>
              {t("admin.v2.agent_name")}
            </label>
            <Input
              id={nameFieldId}
              name="agent-profile-name"
              type="text"
              autoComplete="off"
              maxLength={64}
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancel();
              }}
              disabled={saving}
            />
          </div>
          <div className="agent-personality-editor-guide">
            <p>{t("agents_page.personality_editor_intro")}</p>
            <ol aria-label={t("agents_page.personality_framework")}>
              <li><span>01</span><div><strong>{t("agents_page.personality_purpose")}</strong><small>{t("agents_page.personality_purpose_help")}</small></div></li>
              <li><span>02</span><div><strong>{t("agents_page.personality_truths")}</strong><small>{t("agents_page.personality_truths_help")}</small></div></li>
              <li><span>03</span><div><strong>{t("agents_page.personality_voice")}</strong><small>{t("agents_page.personality_voice_help")}</small></div></li>
              <li><span>04</span><div><strong>{t("agents_page.personality_boundaries")}</strong><small>{t("agents_page.personality_boundaries_help")}</small></div></li>
            </ol>
          </div>
          <div className="agent-personality-editor-toolbar">
            <span>{t("agents_page.personality_editor_label")}</span>
            {!draftPersonality ? (
              <Button variant="ghost" type="button" className="h-auto" onClick={useStarter} disabled={saving}>
                {t("agents_page.personality_starter_action")}
              </Button>
            ) : null}
          </div>
          <Textarea
            ref={textareaRef}
            className="agent-personality-textarea code"
            name="agent-personality"
            aria-label={t("agents_page.personality_title")}
            aria-describedby={helpId}
            rows={14}
            autoComplete="off"
            spellCheck
            value={personalityDraft}
            onChange={(event) => onPersonalityDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSave) {
                event.preventDefault();
                onSave();
              }
              if (event.key === "Escape") onCancel();
            }}
            disabled={saving}
            placeholder={t("agents_page.personality_placeholder")}
          />
          <div className="agent-personality-editor-foot">
            <span className="agent-personality-count tnum">
              {t("agents_page.personality_characters", { count: personalityDraft.length })}
            </span>
            <span className="agent-personality-save-hint">{t("agents_page.personality_save_hint")}</span>
            <div className="agent-personality-actions">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                {t("admin.v2.cancel")}
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={!canSave} loading={saving} loadingLabel={t("admin.v2.saving")}>
                {t("agents_page.save_profile")}
              </Button>
            </div>
          </div>
        </div>
      ) : hasCustomPersonality ? (
        <article className="agent-personality-document">
          <Markdown text={savedPersonality} variant="document" />
        </article>
      ) : (
        <div className="agent-personality-empty">
          <p className="agent-personality-empty-lede">{t("agents_page.personality_empty")}</p>
          <span>{t("agents_page.personality_empty_help")}</span>
        </div>
      )}
    </section>
  );
}
