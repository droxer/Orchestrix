"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionImage,
  ActionRemove,
  ICON,
} from "./icons";

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;

export function ProfileImage({
  src,
  alt,
  fallback,
  className = "",
}: {
  src?: string | null;
  alt: string;
  fallback: ReactNode;
  className?: string;
}) {
  return (
    <span className={`profile-image${className ? ` ${className}` : ""}`} data-has-image={src ? "true" : "false"}>
      {src ? <img src={src} alt={alt} /> : fallback}
    </span>
  );
}

export function ProfileImagePicker({
  imageUrl,
  name,
  fallback,
  editable,
  disabled = false,
  onUpload,
  onRemove,
}: {
  imageUrl?: string | null;
  name: string;
  fallback: ReactNode;
  editable: boolean;
  disabled?: boolean;
  onUpload: (dataUrl: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectImage(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError(t("profile_image.unsupported"));
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      setError(t("profile_image.too_large"));
      return;
    }
    setError(null);
    try {
      await onUpload(await readFileAsDataUrl(file));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("profile_image.failed"));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeImage() {
    setError(null);
    try {
      await onRemove();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t("profile_image.failed"));
    }
  }

  const image = (
    <ProfileImage
      src={imageUrl}
      alt={imageUrl ? t("profile_image.alt", { name }) : ""}
      fallback={fallback}
      className="profile-image-picker-visual"
    />
  );

  return (
    <div className="profile-image-picker">
      {editable ? (
        <>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={t("profile_image.choose")}
            disabled={disabled}
            onChange={(event) => void selectImage(event.target.files?.[0])}
          />
          <button
            type="button"
            className="profile-image-picker-trigger"
            aria-label={imageUrl ? t("profile_image.change") : t("profile_image.choose")}
            title={imageUrl ? t("profile_image.change") : t("profile_image.choose")}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {image}
            <span className="profile-image-picker-action" aria-hidden="true">
              <ActionImage size={ICON.sm} />
            </span>
          </button>
          {imageUrl ? (
            <button
              type="button"
              className="profile-image-picker-remove"
              aria-label={t("profile_image.remove")}
              title={t("profile_image.remove")}
              disabled={disabled}
              onClick={() => void removeImage()}
            >
              <ActionRemove size={ICON.xs} />
            </button>
          ) : null}
        </>
      ) : image}
      {error ? <span className="profile-image-picker-error" role="alert">{error}</span> : null}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unable to read the selected image."));
    };
    reader.readAsDataURL(file);
  });
}
