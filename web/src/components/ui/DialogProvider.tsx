"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readAnimationDurationMs } from "@/lib/animationDuration";
import { acquireBodyScrollLock } from "@/lib/bodyScrollLock";
import { ActionRemove } from "../icons";

// Promise-based confirm/prompt that replaces the native window.confirm /
// window.prompt. Those drop OS chrome into a precision/monochrome product and
// can't carry the danger-tone treatment the design system defines. This keeps
// call sites nearly identical — `if (!(await confirm({...}))) return;` — while
// rendering an in-brand modal.

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" routes the confirm action to the destructive button variant. */
  tone?: "default" | "danger";
};

type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type AnnouncementTone = "info" | "success" | "error";

type AnnouncementOptions = {
  message: string;
  tone?: AnnouncementTone;
};

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

type Announcement = {
  id: number;
  message: string;
  tone: AnnouncementTone;
};

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  announce: (opts: AnnouncementOptions | string) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

const TOAST_VISIBLE_MS = 6000;
const TOAST_EXIT_MS = 160;

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used within <DialogProvider>");
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request | null>(null);
  const [dialogClosing, setDialogClosing] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [toastExiting, setToastExiting] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const announcementId = useRef(0);
  const requestRef = useRef<Request | null>(null);
  const requestQueue = useRef<Request[]>([]);
  const dialogClosingRef = useRef(false);
  const dialogCloseTimer = useRef<number | null>(null);

  const enqueueRequest = useCallback((next: Request) => {
    if (requestRef.current) {
      requestQueue.current.push(next);
      return;
    }
    requestRef.current = next;
    setRequest(next);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => enqueueRequest({ kind: "confirm", opts, resolve })),
    [enqueueRequest],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        enqueueRequest({ kind: "prompt", opts, resolve });
      }),
    [enqueueRequest],
  );

  const announce = useCallback((opts: AnnouncementOptions | string) => {
    const next = typeof opts === "string" ? { message: opts } : opts;
    setToastExiting(false);
    setAnnouncement({
      id: announcementId.current + 1,
      message: next.message,
      tone: next.tone ?? "info",
    });
    announcementId.current += 1;
  }, []);

  // Resolve the pending promise and tear down. `cancelled` carries the
  // negative result (false / null); a positive result passes the value.
  const settle = useCallback((result: boolean | string | null) => {
    const current = requestRef.current;
    if (!current || dialogClosingRef.current) return;
    if (current.kind === "confirm") current.resolve(result === true);
    else current.resolve(typeof result === "string" ? result : null);

    dialogClosingRef.current = true;
    setDialogClosing(true);
    dialogCloseTimer.current = window.setTimeout(() => {
      const next = requestQueue.current.shift() ?? null;
      requestRef.current = next;
      setRequest(next);
      dialogClosingRef.current = false;
      setDialogClosing(false);
      dialogCloseTimer.current = null;
    }, readAnimationDurationMs(dialogRef.current));
  }, []);

  const cancelValue = (req: Request): boolean | null => (req.kind === "confirm" ? false : null);

  const dialogOpen = Boolean(request);

  useEffect(() => {
    if (!dialogOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const releaseScrollLock = acquireBodyScrollLock();

    return () => {
      releaseScrollLock();
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
    };
  }, [dialogOpen]);

  useEffect(() => {
    if (!request || dialogClosing) return;
    if (request.kind === "prompt") setInputValue(request.opts.defaultValue ?? "");
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-default]");
    focusTarget?.focus();
    if (focusTarget instanceof HTMLInputElement) focusTarget.select();

    function handleKeyDown(event: KeyboardEvent) {
      if (!request) return;
      if (event.key === "Escape") {
        event.preventDefault();
        settle(cancelValue(request));
        return;
      }
      // Minimal focus trap — cycle Tab within the modal's focusables.
      if (event.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const focusInside = active ? dialogRef.current?.contains(active) : false;
        if (event.shiftKey) {
          if (active === first || !focusInside) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !focusInside) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialogClosing, request, settle]);

  useEffect(() => () => {
    if (dialogCloseTimer.current !== null) window.clearTimeout(dialogCloseTimer.current);
  }, []);

  const dismissAnnouncement = useCallback(() => {
    setToastExiting(false);
    setAnnouncement(null);
  }, []);

  useEffect(() => {
    if (!announcement) return;
    const exitTimer = window.setTimeout(() => setToastExiting(true), TOAST_VISIBLE_MS - TOAST_EXIT_MS);
    const removeTimer = window.setTimeout(() => {
      setAnnouncement(null);
      setToastExiting(false);
    }, TOAST_VISIBLE_MS);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
    };
  }, [announcement]);

  const isDangerConfirm = request?.kind === "confirm" && request.opts.tone === "danger";

  return (
    <DialogContext.Provider value={{ confirm, prompt, announce }}>
      {children}
      {announcement ? (
        <div
          key={announcement.id}
          className={`dialog-toast${toastExiting ? " dialog-toast--exit" : ""}`}
          data-tone={announcement.tone}
          role={announcement.tone === "error" ? "alert" : "status"}
          aria-live={announcement.tone === "error" ? undefined : "polite"}
          aria-atomic="true"
        >
          <span className="dialog-toast-message">{announcement.message}</span>
          <button
            type="button"
            className="dialog-toast-close"
            aria-label={t("toast.dismiss")}
            title={t("toast.dismiss")}
            onClick={dismissAnnouncement}
          >
            <ActionRemove size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {request && typeof document !== "undefined"
        ? createPortal(
            <div
              className={`overlay-backdrop dialog-backdrop${dialogClosing ? " is-closing" : ""}`}
              role="presentation"
              onMouseDown={(event) => {
                if (!dialogClosing && event.target === event.currentTarget) settle(cancelValue(request));
              }}
            >
              <div
                ref={dialogRef}
                role={request.kind === "prompt" ? "dialog" : "alertdialog"}
                aria-modal="true"
                aria-labelledby="dialog-title"
                aria-describedby={request.opts.message ? "dialog-desc" : undefined}
                tabIndex={-1}
                className={`dialog-modal${dialogClosing ? " is-closing" : ""}`}
                data-tone={isDangerConfirm ? "danger" : undefined}
                inert={dialogClosing || undefined}
              >
                {isDangerConfirm ? (
                  <p className="dialog-kicker">{t("dialog.danger_kicker")}</p>
                ) : null}
                <div className="dialog-title-row">
                  {isDangerConfirm ? (
                    <TriangleAlert size={20} className="dialog-danger-icon" aria-hidden="true" />
                  ) : null}
                  <h2 id="dialog-title" className="dialog-title" translate="no">
                    {request.opts.title}
                  </h2>
                </div>
                {request.opts.message ? (
                  <p id="dialog-desc" className="dialog-message">
                    {request.opts.message}
                  </p>
                ) : null}

                {request.kind === "prompt" ? (
                  <form
                    className="dialog-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      settle(inputValue.trim());
                    }}
                  >
                    <Input
                      data-dialog-default
                      className="dialog-input"
                      name="dialog-prompt"
                      autoComplete="off"
                      aria-labelledby="dialog-title"
                      value={inputValue}
                      placeholder={request.opts.placeholder}
                      onChange={(event) => setInputValue(event.target.value)}
                    />
                  </form>
                ) : null}

                <div className="dialog-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    data-dialog-default={request.kind === "confirm" && request.opts.tone === "danger" ? "" : undefined}
                    disabled={dialogClosing}
                    onClick={() => settle(cancelValue(request))}
                  >
                    {request.opts.cancelLabel ?? t("dialog.cancel")}
                  </Button>
                  {request.kind === "confirm" ? (
                    <Button
                      type="button"
                      variant={request.opts.tone === "danger" ? "destructive" : "default"}
                      data-dialog-default={request.opts.tone === "danger" ? undefined : ""}
                      disabled={dialogClosing}
                      onClick={() => settle(true)}
                    >
                      {request.opts.confirmLabel ?? t("dialog.confirm")}
                    </Button>
                  ) : (
                    <Button type="button" disabled={dialogClosing} onClick={() => settle(inputValue.trim())}>
                      {request.opts.confirmLabel ?? t("dialog.confirm")}
                    </Button>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </DialogContext.Provider>
  );
}
