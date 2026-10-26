"use client";

import MasterDataFormModal from "@/components/ui/MasterDataFormModal";
import { createExpenseCategory, updateExpenseCategory } from "@/app/(dashboard)/expense-categories/actions";
import type { PublicExpenseCategory } from "@/app/(dashboard)/expense-categories/queries";

// Create / edit — the shared master-data modal, name-only (no logo), in the
// Expenses design's layout. Empty for create, pre-filled from the row for
// edit. X, overlay click and Escape close it (MasterDataModal).
export default function ExpenseCategoryModal({
  category,
  onClose,
}: {
  category: PublicExpenseCategory | null;
  onClose: () => void;
}) {
  return (
    <MasterDataFormModal
      item={category}
      titleCreate="Create Expense Category"
      titleEdit="Edit Expense Category"
      showLogo={false}
      modalLayout="simple"
      onClose={onClose}
      // The server re-checks the permission (and, on edit, re-reads the id).
      onSubmit={(formData) =>
        category ? updateExpenseCategory(category.id, formData) : createExpenseCategory(formData)
      }
      successMessageCreate="Expense category created successfully."
      successMessageEdit="Expense category updated successfully."
    />
  );
}
