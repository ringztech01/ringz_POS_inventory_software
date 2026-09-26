"use client";

import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import GhostButton from "@/components/ui/GhostButton";

export default function ImportSuppliersButton() {
  return (
    <GhostButton paddingX={16} onClick={() => toast("Supplier import is coming soon.")}>
      <Upload size={15} strokeWidth={1.8} />
      Import Suppliers
    </GhostButton>
  );
}
