"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MENU_STRINGS as S } from "../../lib/menuStrings";
import { dragTo, frameAt, inertia, isSlowDevice, type DeviceHints } from "../../lib/menuDevice";
import { loadModelViewer } from "./loadModelViewer";

// The item detail's picture (Part 8 Step 4): the photo, a 360° spin or a 3D
// model. The spin and the 3D view fall back to the photo whenever they can't
// run, and the "Lighter menu" turns them off.

type Photo = { thumb: string; full: string } | null;
const BOX: CSSProperties = { position: "relative", width: "100%", aspectRatio: "4 / 3", maxHeight: "52vh", background: "#eef1f2", overflow: "hidden" };
const QUIET = "#6d777a";

function Photo({ photo, name }: { photo: Photo; name: string }) {
  if (!photo) return <div style={{ ...BOX, display: "flex", alignItems: "center", justifyContent: "center", color: "#97a1a4", fontSize: 13 }}>{S.noPhoto}</div>;
  return (
    <div style={BOX}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the menu's own WebP on the LAN; no image server */}
      <img data-item-photo src={photo.full} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", background: `url(${photo.thumb}) center / cover` }} />
    </div>
  );
}

function Overlay({ children, bottom = false }: { children: ReactNode; bottom?: boolean }) {
  return <div style={{ position: "absolute", left: 0, right: 0, [bottom ? "bottom" : "top"]: 0, padding: 12, display: "flex", justifyContent: "center", pointerEvents: "none" }}>{children}</div>;
}

const chip: CSSProperties = { pointerEvents: "auto", border: "none", borderRadius: 18, padding: "8px 14px", background: "rgba(23,27,28,.82)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
const note = (text: string) => (
  <p data-item-media-note style={{ margin: "8px 16px 0", fontSize: 12.5, color: QUIET }}>
    {text}
  </p>
);

function Ring({ done, total }: { done: number; total: number }) {
  const r = 16;
  const length = 2 * Math.PI * r;
  return (
    <span data-spin-progress={`${done}/${total}`} style={{ ...chip, display: "inline-flex", alignItems: "center", gap: 8, cursor: "default" }}>
      <svg width={22} height={22} viewBox="0 0 40 40" aria-hidden>
        <circle cx={20} cy={20} r={r} fill="none" stroke="rgba(255,255,255,.3)" strokeWidth={5} />
        <circle cx={20} cy={20} r={r} fill="none" stroke="#fff" strokeWidth={5} strokeDasharray={length} strokeDashoffset={length * (1 - done / Math.max(total, 1))} transform="rotate(-90 20 20)" />
      </svg>
      {S.spinLoading(done, total)}
    </span>
  );
}

// 360°: the first frame first, then the rest in the background (a progress
// ring); drag left or right to turn it, and it keeps turning a little after.
export function SpinView({ frames, photo, name }: { frames: string[]; photo: Photo; name: string }) {
  // A slow phone waits for a tap; others start straight away. (Only ever
  // shown after a tap, in the browser: the phone is there to ask.)
  const [mode, setMode] = useState<"wait" | "loading" | "ready" | "failed">(() => {
    const hints = navigator as Navigator & DeviceHints;
    return isSlowDevice({ connection: hints.connection, deviceMemory: hints.deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency }) ? "wait" : "loading";
  });
  const [loaded, setLoaded] = useState(0);
  const [first, setFirst] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const position = useRef(0);
  const drag = useRef<{ x: number; start: number; lastX: number; lastT: number; v: number } | null>(null);
  const spin = useRef(0);

  useEffect(() => {
    if (mode !== "loading") return;
    let cancelled = false;
    let count = 0;
    const load = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(src));
        image.src = src;
      });
    (async () => {
      try {
        await load(frames[0]);
        if (cancelled) return;
        setFirst(true);
        setLoaded((count = 1));
        // The rest, a few at a time.
        const rest = frames.slice(1);
        for (let i = 0; i < rest.length; i += 6) {
          await Promise.all(rest.slice(i, i + 6).map((src) => load(src).then(() => !cancelled && setLoaded(++count))));
          if (cancelled) return;
        }
        setMode("ready");
      } catch {
        if (!cancelled) setMode("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, frames]);

  useEffect(() => () => cancelAnimationFrame(spin.current), []);

  const show = (pos: number) => {
    position.current = pos;
    if (img.current) img.current.src = frames[frameAt(pos, frames.length)];
  };

  if (mode === "failed") {
    return (
      <>
        <Photo photo={photo} name={name} />
        {note(S.spinFailed)}
      </>
    );
  }
  if (mode === "wait") {
    return (
      <div style={{ position: "relative" }}>
        <Photo photo={photo} name={name} />
        <Overlay bottom>
          <button type="button" data-spin-load onClick={() => setMode("loading")} style={chip}>
            {S.spinLoad}
          </button>
        </Overlay>
      </div>
    );
  }
  return (
    <div
      data-spin={mode}
      style={{ ...BOX, touchAction: "pan-y", cursor: mode === "ready" ? "grab" : "default", userSelect: "none" }}
      onPointerDown={(e) => {
        if (mode !== "ready") return;
        cancelAnimationFrame(spin.current);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, start: position.current, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dt = Math.max(1, e.timeStamp - d.lastT);
        d.v = -(e.clientX - d.lastX) / 8 / dt;
        d.lastX = e.clientX;
        d.lastT = e.timeStamp;
        show(dragTo(d.start, e.clientX - d.x));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        let v = d.v;
        const step = () => {
          const next = inertia(position.current, v);
          show(next.position);
          v = next.velocity;
          if (!next.done) spin.current = requestAnimationFrame(step);
        };
        spin.current = requestAnimationFrame(step);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element -- the spin's frames, swapped in place while dragging
        <img ref={img} data-spin-frame src={frames[0]} alt={name} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
      ) : (
        photo && (
          // eslint-disable-next-line @next/next/no-img-element -- the thumbnail while the first frame loads
          <img src={photo.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )
      )}
      <Overlay bottom>{mode === "ready" ? <span style={{ ...chip, cursor: "inherit", background: "rgba(23,27,28,.55)" }}>{S.spinHint}</span> : <Ring done={loaded} total={frames.length} />}</Overlay>
    </div>
  );
}

const hasWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

// 3D: the photo with "View in 3D"; <model-viewer> loads only on that tap.
// "View on your table" (AR) appears when the phone can: the USDZ on iPhone,
// the GLB on Android. No WebGL, or it fails: the photo again.
export function ModelView({ files, photo, name }: { files: { glb: string; usdz: string | null }; photo: Photo; name: string }) {
  const [state, setState] = useState<"photo" | "loading" | "ready" | "failed" | "nowebgl">(() => (hasWebGL() ? "photo" : "nowebgl"));
  const host = useRef<HTMLDivElement>(null);

  // Made once on the tap, kept while it loads and after.
  const live = state === "loading" || state === "ready";
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let viewer: HTMLElement | null = null;
    loadModelViewer()
      .then(() => {
        if (cancelled || !host.current) return;
        viewer = document.createElement("model-viewer");
        const attrs: Record<string, string> = {
          src: files.glb,
          alt: name,
          ar: "",
          "ar-modes": "webxr scene-viewer quick-look",
          "camera-controls": "",
          "touch-action": "pan-y",
          "auto-rotate": "",
          "shadow-intensity": "1",
          loading: "eager",
          "data-model-viewer": "",
        };
        if (files.usdz) attrs["ios-src"] = files.usdz;
        if (photo) attrs.poster = photo.full;
        for (const [k, v] of Object.entries(attrs)) viewer.setAttribute(k, v);
        viewer.style.width = "100%";
        viewer.style.height = "100%";
        viewer.style.setProperty("--poster-color", "transparent");
        // Shown by <model-viewer> only when this phone can place it in the room.
        const ar = document.createElement("button");
        ar.slot = "ar-button";
        ar.type = "button";
        ar.textContent = S.viewOnTable;
        ar.setAttribute("data-view-on-table", "");
        Object.assign(ar.style, { position: "absolute", bottom: "12px", left: "50%", transform: "translateX(-50%)", border: "none", borderRadius: "18px", padding: "8px 14px", background: "#0f7d6a", color: "#fff", fontSize: "13px", fontWeight: "600", fontFamily: "inherit" });
        viewer.appendChild(ar);
        viewer.addEventListener("load", () => !cancelled && setState("ready"));
        viewer.addEventListener("error", () => !cancelled && setState("failed"));
        host.current.appendChild(viewer);
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
      viewer?.remove();
    };
  }, [live, files.glb, files.usdz, name, photo]);

  if (state === "photo" || state === "nowebgl" || state === "failed") {
    return (
      <>
        <div style={{ position: "relative" }}>
          <Photo photo={photo} name={name} />
          {state === "photo" && (
            <Overlay bottom>
              <button type="button" data-view-3d onClick={() => setState("loading")} style={chip}>
                {S.view3d}
              </button>
            </Overlay>
          )}
        </div>
        {state === "nowebgl" && note(S.noWebgl)}
        {state === "failed" && note(S.model3dFailed)}
      </>
    );
  }
  return (
    <div ref={host} data-model={state} style={BOX}>
      {state === "loading" && (
        <Overlay>
          <span style={{ ...chip, cursor: "default" }}>{S.loading3d}</span>
        </Overlay>
      )}
    </div>
  );
}

// The picture for an item: its chosen media, unless the Lighter menu is on.
export function ItemMedia({ item, lighter }: { item: { name: string; photo: Photo; spinFrames: string[] | null; modelFiles: { glb: string; usdz: string | null } | null }; lighter: boolean }) {
  if (!lighter && item.spinFrames) return <SpinView frames={item.spinFrames} photo={item.photo} name={item.name} />;
  if (!lighter && item.modelFiles) return <ModelView files={item.modelFiles} photo={item.photo} name={item.name} />;
  return <Photo photo={item.photo} name={item.name} />;
}
