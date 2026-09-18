import { useCallback, useState } from "react";

export function useToggleState(initial = false) {
  const [value, setValue] = useState(initial);
  const on = useCallback(() => setValue(true), []);
  const off = useCallback(() => setValue(false), []);
  return { value, on, off };
}
