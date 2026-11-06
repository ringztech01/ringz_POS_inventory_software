"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { useHasCamera, useScanDispatch } from "./ScanProvider";

// Camera scanning (tablets, phones): the back camera, decoded on the device
// by ZXing (bundled — works offline; loaded only when the camera opens). The
// first code read goes to the current screen exactly like a scanner's
// (ScanProvider's dispatch). Browsers allow the camera only on https:// or
// on localhost.

export function CameraScanModal({ onClose, onCode }: { onClose: () => void; onCode?: (code: string) => void }) {
  const dispatch = useScanDispatch();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const done = useRef(false);
  const handle = useRef<(code: string) => void>(() => {});
  useEffect(() => {
    handle.current = (code: string) => {
      if (done.current) return;
      done.current = true;
      if (onCode) onCode(code);
      else dispatch(code, "camera");
      onClose();
    };
  });

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("The camera needs a secure connection: open the app with https://, or on this device as localhost.");
        setStarting(false);
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video.current, (result) => {
          if (result) handle.current(result.getText().trim());
        });
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
        setStarting(false);
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(name === "NotAllowedError" ? "Camera access was refused — allow the camera for this site in the browser, then try again." : name === "NotFoundError" ? "No camera found on this device." : "The camera couldn't start.");
        setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(7,27,24,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 95, padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Scan with the camera" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 14, overflow: "hidden", fontFamily: FONTS.body }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 16, fontWeight: 700 }}>Scan with the camera</h2>
          <button type="button" aria-label="Close" onClick={onClose} style={{ width: 32, height: 32, border: "none", background: "transparent", cursor: "pointer", color: COLORS.slate, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ position: "relative", background: "#000", aspectRatio: "4 / 3" }}>
          <video ref={video} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: error ? "none" : "block" }} />
          {!error && <div aria-hidden style={{ position: "absolute", inset: "22% 12%", border: "2px solid rgba(255,255,255,.85)", borderRadius: 10, boxShadow: "0 0 0 9999px rgba(0,0,0,.25)" }} />}
          {(error || starting) && (
            <p role={error ? "alert" : undefined} style={{ position: "absolute", inset: 0, margin: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: "#fff", fontSize: 14 }}>
              {error ?? "Starting the camera…"}
            </p>
          )}
        </div>
        <p style={{ margin: 0, padding: "12px 18px", fontSize: 13, color: COLORS.slateMid }}>Hold the barcode inside the frame. It&apos;s read on this device — nothing is sent anywhere.</p>
      </div>
    </div>
  );
}

// A camera button, shown only on devices that have a camera. `render` draws
// the button in the screen's own style.
export default function CameraScanButton({ render }: { render: (open: () => void) => ReactNode }) {
  const hasCamera = useHasCamera();
  const [open, setOpen] = useState(false);
  if (!hasCamera) return null;
  return (
    <>
      {render(() => setOpen(true))}
      {open && <CameraScanModal onClose={() => setOpen(false)} />}
    </>
  );
}
