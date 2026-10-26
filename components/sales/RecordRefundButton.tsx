"use client";

import { HandCoins } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SalePaymentsModal from "./SalePaymentsModal";

// "Record refund" on the Sale Return Details header: the shared payments
// modal, managing the return's refunds (SaleReturnPayment).
export default function RecordRefundButton({ saleReturnId }: { saleReturnId: string }) {
  const { value: isOpen, on: open, off: close } = useToggleState();

  return (
    <>
      <PrimaryButton onClick={open}>
        <HandCoins size={15} strokeWidth={1.7} />
        Record refund
      </PrimaryButton>
      {isOpen && <SalePaymentsModal documentId={saleReturnId} kind="saleReturn" onClose={close} />}
    </>
  );
}
