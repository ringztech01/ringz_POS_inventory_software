"use client";

import { Tags } from "lucide-react";
import MasterDataListPage from "@/components/ui/MasterDataListPage";
import ExpenseCategoryModal from "./ExpenseCategoryModal";
import DeleteExpenseCategoryButton from "./DeleteExpenseCategoryButton";
import type { PublicExpenseCategory } from "@/app/(dashboard)/expense-categories/queries";

// The shared master-data list (as Product Categories / Brands), in its
// name-only layout from the Expenses design's categories view.
export default function ExpenseCategoriesInteractive({
  categories,
  total,
  page,
  perPage,
  totalPages,
  perPageOptions,
}: {
  categories: PublicExpenseCategory[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  perPageOptions: number[];
}) {
  return (
    <MasterDataListPage<PublicExpenseCategory>
      title="Expense Categories"
      entityNameSingular="category"
      entityNamePlural="categories"
      createLabel="Create Expense Category"
      columnLabel="Name"
      emptyIcon={Tags}
      emptyMessage="No expense categories found."
      items={categories}
      total={total}
      page={page}
      perPage={perPage}
      totalPages={totalPages}
      showFilters={false}
      nameOnly
      editTitle="Edit category"
      perPageOptions={perPageOptions}
      showPageNumbers
      renderDelete={(category) => <DeleteExpenseCategoryButton id={category.id} name={category.name} />}
      renderModal={(modal, close) => <ExpenseCategoryModal category={modal.item} onClose={close} />}
    />
  );
}
