"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { customerSchema } from "@/lib/validations/customer";
import { isCustomerInUse } from "./queries";
import type { CustomerActionState } from "./types";

async function requireManageCustomers(): Promise<{ error: string } | { error?: undefined }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in to do that." };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_CUSTOMERS)) {
    return { error: "You don't have permission to manage customers." };
  }

  return {};
}

function parseCustomerFormData(formData: FormData) {
  return customerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    dateOfBirth: formData.get("dateOfBirth"),
    country: formData.get("country"),
    city: formData.get("city"),
    address: formData.get("address"),
  });
}

// The <input type="date"> field gives us a plain "YYYY-MM-DD" string with no
// time or timezone component. Anchoring it explicitly at UTC midnight (both
// here and when formatting it back for the form in CustomerForm) means the
// calendar date never shifts by a day depending on the server's or the
// browser's local timezone — the classic date-only round-trip bug.
function parseDateOfBirth(value?: string): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export async function createCustomer(formData: FormData): Promise<CustomerActionState> {
  const authCheck = await requireManageCustomers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const parsed = parseCustomerFormData(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { dateOfBirth, ...rest } = parsed.data;

  await prisma.customer.create({
    data: { ...rest, dateOfBirth: parseDateOfBirth(dateOfBirth) },
  });

  revalidatePath("/peoples/customers");

  return { status: "success", message: "Customer created successfully." };
}

export async function updateCustomer(id: string, formData: FormData): Promise<CustomerActionState> {
  const authCheck = await requireManageCustomers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted customer by the time this runs.
  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "Customer not found." };
  }

  const parsed = parseCustomerFormData(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { dateOfBirth, ...rest } = parsed.data;

  // direct-customer is the walk-in customer the POS falls back to when no
  // specific customer is selected — code elsewhere may match on this exact
  // name, so it can't be renamed even by an otherwise-permitted edit. Other
  // fields (email, phone, country, city, address) can still be changed.
  if (existing.isDefault) {
    rest.name = existing.name;
  }

  await prisma.customer.update({
    where: { id },
    data: { ...rest, dateOfBirth: parseDateOfBirth(dateOfBirth) },
  });

  revalidatePath("/peoples/customers");

  return { status: "success", message: "Customer updated successfully." };
}

export async function deleteCustomer(id: string): Promise<CustomerActionState> {
  const authCheck = await requireManageCustomers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "Customer not found." };
  }

  // direct-customer is the walk-in customer the POS uses whenever a sale
  // isn't tied to a specific customer. Deleting it would break every such
  // sale's reference, so this is a hard server-side rule — not just a
  // disabled button in the UI, which a direct call to this action would
  // bypass.
  if (existing.isDefault) {
    return { status: "error", message: "The direct-customer record can't be deleted." };
  }

  if (await isCustomerInUse(id)) {
    return { status: "error", message: "This customer has related sales or quotations and can't be deleted." };
  }

  await prisma.customer.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/peoples/customers");

  return { status: "success", message: "Customer deleted successfully." };
}
