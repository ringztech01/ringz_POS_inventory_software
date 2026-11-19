// Copy text to the clipboard in the browser. navigator.clipboard only
// exists on secure pages (HTTPS or localhost); tills on the shop's Wi-Fi open
// the app over http://192.168…, so there the older copy command does it,
// from a hidden text box (it works on any page, from a tap). Resolves true
// when the text was copied.
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, the page not focused): try the old way.
    }
  }
  if (typeof document === "undefined") return false;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.top = "-1000px";
  box.style.opacity = "0";
  document.body.appendChild(box);
  const focused = document.activeElement as HTMLElement | null;
  try {
    box.select();
    box.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
    focused?.focus?.();
  }
}
