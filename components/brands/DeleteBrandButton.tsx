"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import IconActionButton from "@/components/ui/IconActionButton";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deleteBrand } from "@/app/(dashboard)/brands/actions";

export default function DeleteBrandButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { value: isConfirmOpen, on: openConfirm, off: closeConfirm } = useToggleState();
  const [isPending, startTransition] = useTransition();

  function handleConfirmDelete() {
    startTransition(async () => {
      const result = await deleteBrand(id);

      if (result.ok) {
        toast.success("Brand deleted successfully.");
        closeConfirm();
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
        closeConfirm();
      }
    });
  }

  return (
    <>
      <IconActionButton
        icon={<Trash2 size={15} strokeWidth={1.8} />}
        title="Delete"
        tone="danger"
        size={34}
        onClick={openConfirm}
      />

      {isConfirmOpen && (
        <ConfirmDeleteModal
          title="Delete brand"
          message={`Are you sure you want to delete "${name}"? This can't be undone from here.`}
          onCancel={closeConfirm}
          onConfirm={handleConfirmDelete}
          pending={isPending}
        />
      )}
    </>
  );
}
