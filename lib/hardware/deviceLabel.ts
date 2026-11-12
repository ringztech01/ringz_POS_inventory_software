// A device for people (Settings › Devices, Settings › Staff): its name, or
// what it is.

// "Chrome on Windows", "Safari on iPad"…
export function browserOf(userAgent: string | null): string {
  if (!userAgent) return "Unknown browser";
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("OPR/")
      ? "Opera"
      : userAgent.includes("Firefox/")
        ? "Firefox"
        : userAgent.includes("Chrome/")
          ? "Chrome"
          : userAgent.includes("Safari/")
            ? "Safari"
            : "Browser";
  const os = userAgent.includes("iPad")
    ? "iPad"
    : userAgent.includes("iPhone")
      ? "iPhone"
      : userAgent.includes("Android")
        ? "Android"
        : userAgent.includes("Windows")
          ? "Windows"
          : userAgent.includes("Mac OS X")
            ? "Mac"
            : userAgent.includes("Linux")
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

export const deviceLabel = (device: { name: string | null; userAgent: string | null } | null): string | null => (device ? device.name || browserOf(device.userAgent) : null);
