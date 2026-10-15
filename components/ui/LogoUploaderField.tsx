"use client";

import { useRef, type ChangeEvent } from "react";
import { Image as ImageIcon, Pencil } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

export default function LogoUploaderField({
  label = "Change logo",
  hint,
  previewSrc,
  fileName,
  onFileChange,
  name = "logo",
}: {
  label?: string;
  hint: string;
  previewSrc: string | null;
  fileName: string | null;
  onFileChange: (file: File | null) => void;
  name?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const changeHover = useToggleState();
  const chooseHover = useToggleState();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFileChange(event.target.files?.[0] ?? null);
  }

  function triggerPick() {
    inputRef.current?.click();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 112, height: 112, flex: "0 0 auto" }}>
          <div
            style={{
              width: 112,
              height: 112,
              border: "1.5px dashed #c3cacc",
              borderRadius: 10,
              overflow: "hidden",
              backgroundColor: COLORS.bgInput,
              backgroundImage: previewSrc
                ? undefined
                : `repeating-linear-gradient(135deg, ${COLORS.border} 0 6px, transparent 6px 12px)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLORS.slateLight,
            }}
          >
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <ImageIcon size={24} strokeWidth={1.6} />
            )}
          </div>
          <button
            type="button"
            title="Change logo"
            onClick={triggerPick}
            onMouseEnter={changeHover.on}
            onMouseLeave={changeHover.off}
            style={{
              position: "absolute",
              top: -8,
              right: -8,
              width: 30,
              height: 30,
              borderRadius: 999,
              border: `1px solid ${COLORS.borderStrong}`,
              background: changeHover.value ? COLORS.tealTint : "#fff",
              boxShadow: "0 2px 8px -1px rgba(23,27,28,.10)",
              cursor: "pointer",
              color: COLORS.teal,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background .12s",
            }}
          >
            <Pencil size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateMid }}>{hint}</span>
          <button
            type="button"
            onClick={triggerPick}
            onMouseEnter={chooseHover.on}
            onMouseLeave={chooseHover.off}
            style={{
              height: 34,
              padding: "0 14px",
              background: chooseHover.value ? COLORS.bgApp : "#fff",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.text,
              cursor: "pointer",
              alignSelf: "flex-start",
              transition: "background .12s",
            }}
          >
            Choose file
          </button>
          <span style={{ fontSize: 12, color: COLORS.slateLight }}>{fileName ?? "No file chosen"}</span>
        </div>
      </div>
      <input ref={inputRef} type="file" name={name} accept="image/*" onChange={handleChange} style={{ display: "none" }} />
    </div>
  );
}
