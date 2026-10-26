"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import IconActionButton from "@/components/ui/IconActionButton";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deleteExpenseCategory } from "@/app/(dashboard)/expense-categories/actions";

// "Delete category" + the shared confirm dialog (as DeleteCategoryButton).
// The server re-checks the permission, re-reads the id and refuses while
// expenses still use the category.
export default function DeleteExpenseCategoryButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { value: isConfirmOpen, on: openConfirm, off: closeConfirm } = useToggleState();
  const [isPending, startTransition] = useTransition();

  function handleConfirmDelete() {
    startTransition(async () => {
      const result = await deleteExpenseCategory(id);
      closeConfirm();

      if (result.ok) {
        toast.success("Expense category deleted successfully.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <>
      <IconActionButton
        icon={<Trash2 size={15} strokeWidth={1.8} />}
        title="Delete category"
        tone="danger"
        size={32}
        onClick={openConfirm}
      />

      {isConfirmOpen && (
        <ConfirmDeleteModal
          title="Delete expense category"
          message={`Are you sure you want to delete "${name}"? This can't be undone from here.`}
          onCancel={closeConfirm}
          onConfirm={handleConfirmDelete}
          pending={isPending}
        />
      )}
    </>
  );
}
