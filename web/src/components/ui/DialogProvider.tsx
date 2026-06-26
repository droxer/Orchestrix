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
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

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

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used within <DialogProvider>");
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request | null>(null);
  const [inputValue, setInputValue] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ kind: "confirm", opts, resolve })),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setInputValue(opts.defaultValue ?? "");
        setRequest({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  // Resolve the pending promise and tear down. `cancelled` carries the
  // negative result (false / null); a positive result passes the value.
  const settle = useCallback((result: boolean | string | null) => {
    setRequest((current) => {
      if (!current) return null;
      if (current.kind === "confirm") current.resolve(result === true);
      else current.resolve(typeof result === "string" ? result : null);
      return null;
    });
  }, []);

  const cancelValue = (req: Request): boolean | null => (req.kind === "confirm" ? false : null);

  useEffect(() => {
    if (!request) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
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
          'button, input, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [request, settle]);

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {request && typeof document !== "undefined"
        ? createPortal(
            <div
              className="dialog-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) settle(cancelValue(request));
              }}
            >
              <div
                ref={dialogRef}
                role={request.kind === "prompt" ? "dialog" : "alertdialog"}
                aria-modal="true"
                aria-labelledby="dialog-title"
                aria-describedby={request.opts.message ? "dialog-desc" : undefined}
                tabIndex={-1}
                className="dialog-modal"
              >
                <h2 id="dialog-title" className="dialog-title">
                  {request.opts.title}
                </h2>
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
                    <input
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
                    variant="secondary"
                    data-dialog-default={request.kind === "confirm" && request.opts.tone === "danger" ? "" : undefined}
                    onClick={() => settle(cancelValue(request))}
                  >
                    {request.opts.cancelLabel ?? t("dialog.cancel")}
                  </Button>
                  {request.kind === "confirm" ? (
                    <Button
                      variant={request.opts.tone === "danger" ? "destructive" : "default"}
                      data-dialog-default={request.opts.tone === "danger" ? undefined : ""}
                      onClick={() => settle(true)}
                    >
                      {request.opts.confirmLabel ?? t("dialog.confirm")}
                    </Button>
                  ) : (
                    <Button onClick={() => settle(inputValue.trim())}>
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
