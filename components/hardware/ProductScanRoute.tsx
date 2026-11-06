"use client";

import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { findProductByCode } from "@/lib/hardware/scanActions";
import { useScan } from "./ScanProvider";

// The back office's default for a scan (a screen with its own handler wins):
// open the product with that code. The restaurant screens ignore scans for
// now, so a waiter's stray scan never leaves an order.
export default function ProductScanRoute() {
  const router = useRouter();
  const pathname = usePathname();
  useScan(
    (code) => {
      if (pathname.startsWith("/restaurant")) return;
      void findProductByCode(code).then((found) => {
        if (!found.ok) {
          toast.error(found.error);
          return;
        }
        toast.success(`Scanned: ${found.name}`);
        router.push(`/products/${found.id}`);
      });
    },
    { fallback: true },
  );
  return null;
}
