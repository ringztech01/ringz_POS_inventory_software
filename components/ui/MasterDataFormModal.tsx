"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import MasterDataModal from "./MasterDataModal";
import LogoUploaderField from "./LogoUploaderField";

export type MasterDataActionResult = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string[]>>;
};

export type MasterDataFormItem = {
  id: string;
  name: string;
  logo?: string | null;
};

export default function MasterDataFormModal({
  item,
  titleCreate,
  titleEdit,
  logoHint,
  onClose,
  onSubmit,
  successMessageCreate,
  successMessageEdit,
  showLogo = true,
}: {
  item: MasterDataFormItem | null;
  titleCreate: string;
  titleEdit: string;
  logoHint?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<MasterDataActionResult>;
  successMessageCreate: string;
  successMessageEdit: string;
  showLogo?: boolean;
}) {
  const router = useRouter();
  const isEdit = !!item;
  const [name, setName] = useState(item?.name ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name", string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const nameFocus = useToggleState();

  function handleFileChange(file: File | null) {
    setLogoFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFieldErrors({});

    startTransition(async () => {
      const result = await onSubmit(formData);

      if (result.ok) {
        toast.success(isEdit ? successMessageEdit : successMessageCreate);
        router.refresh();
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const displayedPreview = previewUrl ?? item?.logo ?? null;


  return (
    <MasterDataModal
      title={isEdit ? titleEdit : titleCreate}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
          Name <span style={{ color: COLORS.danger }}>*</span>
        </label>
        <input
          name="name"
          placeholder="Enter Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={nameFocus.on}
          onBlur={nameFocus.off}
          style={{
            height: 40,
            border: `1px solid ${fieldErrors.name ? COLORS.danger : nameFocus.value ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 8,
            padding: "0 12px",
            fontSize: 14,
            outline: "none",
            boxShadow: nameFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
            transition: "border-color .12s, box-shadow .12s",
          }}
        />
        {fieldErrors.name?.[0] && <span style={{ fontSize: 12, color: COLORS.danger }}>{fieldErrors.name[0]}</span>}
      </div>

      {showLogo && (
        <LogoUploaderField
          hint={logoHint ?? ""}
          previewSrc={displayedPreview}
          fileName={logoFile?.name ?? null}
          onFileChange={handleFileChange}
        />
      )}
    </MasterDataModal>
  );
}
