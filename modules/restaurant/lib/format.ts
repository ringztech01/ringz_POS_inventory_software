// An order's reference as the designs show it: ORD-0142.
export function orderRef(number: number): string {
  return `ORD-${String(number).padStart(4, "0")}`;
}
