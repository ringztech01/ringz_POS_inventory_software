"use client";

import { useEffect, useRef, useState } from "react";
import { MENU_STRINGS } from "../../../lib/menuStrings";
import { dragTo, frameAt, inertia, isSlowDevice, type DeviceHints } from "../../../lib/menuDevice";
import { degreesAt } from "../../../lib/showcaseMenu";
import type { PublicMenuItem } from "../../../lib/publicMenu";
import { loadModelViewer } from "../loadModelViewer";
import css from "./showcase.module.css";

// The top of a dish's sheet in the Showcase menu: its photo on a plate, its
// 360° spin or its 3D model, with the Photo / 360° / 3D switch. Only views
// the dish really has (its uploaded spin frames or model) can be picked; the
// others are greyed out. The spin and the model fall back to the photo
// whenever they can't run; the Lighter menu turns them off.

const S = MENU_STRINGS;
const T = MENU_STRINGS.showcase;
export type StageMode = "photo" | "spin" | "model";
type Photo = PublicMenuItem["photo"];

export function Plate({ photo, name, className, sizes = "full", style }: { photo: Photo; name: string; className?: string; sizes?: "thumb" | "full"; style?: React.CSSProperties }) {
  return (
    <div className={`${css.plate} ${className ?? ""}`} style={style}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- the menu's own WebP on the LAN; no image server
        <img
          className={css.plateImg}
          src={sizes === "thumb" ? photo.thumb : photo.full}
          alt={sizes === "thumb" ? "" : name}
          loading={sizes === "thumb" ? "lazy" : undefined}
          decoding="async"
          draggable={false}
          style={sizes === "full" ? { background: `#d8ccbb url(${photo.thumb}) center / cover` } : undefined}
        />
      ) : (
        <div className={css.plateEmpty}>{S.noPhoto}</div>
      )}
    </div>
  );
}

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 360°: the dish's own frames. The first one first, then the rest in the
// background; drag to turn it (it keeps turning a little after), and once
// they're all in it turns slowly by itself until touched. A slow phone waits
// for a tap.
function Spin({ frames, photo, name, degRef }: { frames: string[]; photo: Photo; name: string; degRef: React.RefObject<HTMLSpanElement | null> }) {
  const [mode, setMode] = useState<"wait" | "loading" | "ready" | "failed">(() => {
    const hints = navigator as Navigator & DeviceHints;
    return isSlowDevice({ connection: hints.connection, deviceMemory: hints.deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency }) ? "wait" : "loading";
  });
  const [loaded, setLoaded] = useState(0);
  const [first, setFirst] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const position = useRef(0);
  const drag = useRef<{ x: number; start: number; lastX: number; lastT: number; v: number } | null>(null);
  const velocity = useRef(0);
  const idleSince = useRef(0);

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

  // One animation loop: inertia after a drag, then the slow turn.
  useEffect(() => {
    if (mode !== "ready") return;
    let raf = 0;
    let last = performance.now();
    idleSince.current = last;
    const still = reducedMotion();
    const show = () => {
      const p = position.current;
      if (img.current) img.current.src = frames[frameAt(p, frames.length)];
      const deg = degreesAt(p, frames.length);
      if (degRef.current) degRef.current.textContent = `${deg}°`;
      if (dot.current) {
        const a = (deg * Math.PI) / 180;
        dot.current.setAttribute("cx", (100 + 96 * Math.sin(a)).toFixed(1));
        dot.current.setAttribute("cy", (23 + 19 * Math.cos(a)).toFixed(1));
      }
    };
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!drag.current) {
        if (Math.abs(velocity.current) > 0) {
          const next = inertia(position.current, velocity.current, dt);
          position.current = next.position;
          velocity.current = next.done ? 0 : next.velocity;
          if (next.done) idleSince.current = now;
          show();
        } else if (!still && now - idleSince.current > 2500) {
          // A full turn in about 20 s.
          position.current += (frames.length / 20000) * dt;
          show();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    show();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, frames, degRef]);

  if (mode === "failed" || mode === "wait") {
    return (
      <>
        <Plate photo={photo} name={name} className={css.stagePlate} />
        {mode === "failed" ? (
          <p data-item-media-note className={css.stageNote}>
            {S.spinFailed}
          </p>
        ) : (
          <div className={css.stageNote}>
            <button type="button" data-spin-load className={css.pillNote} onClick={() => setMode("loading")}>
              {S.spinLoad}
            </button>
          </div>
        )}
      </>
    );
  }
  return (
    <div
      data-spin={mode}
      className={css.spinBox}
      onPointerDown={(e) => {
        if (mode !== "ready") return;
        e.currentTarget.setPointerCapture(e.pointerId);
        velocity.current = 0;
        drag.current = { x: e.clientX, start: position.current, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dt = Math.max(1, e.timeStamp - d.lastT);
        d.v = -(e.clientX - d.lastX) / 8 / dt;
        d.lastX = e.clientX;
        d.lastT = e.timeStamp;
        position.current = dragTo(d.start, e.clientX - d.x);
        if (img.current) img.current.src = frames[frameAt(position.current, frames.length)];
        const deg = degreesAt(position.current, frames.length);
        if (degRef.current) degRef.current.textContent = `${deg}°`;
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        idleSince.current = performance.now();
        if (d) velocity.current = d.v;
      }}
      onPointerCancel={() => {
        drag.current = null;
        idleSince.current = performance.now();
      }}
    >
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element -- the spin's frames, swapped in place while dragging
        <img ref={img} data-spin-frame className={css.spinImg} src={frames[0]} alt={name} draggable={false} />
      ) : (
        photo && (
          // eslint-disable-next-line @next/next/no-img-element -- the thumbnail while the first frame loads
          <img className={css.spinImg} src={photo.thumb} alt="" draggable={false} />
        )
      )}
      <svg className={css.orbit} viewBox="0 0 200 46" preserveAspectRatio="none" aria-hidden>
        <ellipse cx={100} cy={23} rx={96} ry={19} fill="none" stroke="rgba(242,169,59,.45)" strokeWidth={1.5} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        <circle ref={dot} cx={100} cy={42} r={5} fill="#F2A93B" />
      </svg>
      {mode === "loading" && (
        <span data-spin-progress={`${loaded}/${frames.length}`} className={css.stageNote} style={{ top: "auto", bottom: -58 }}>
          {S.spinLoading(loaded, frames.length)}
        </span>
      )}
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

// 3D: the dish's own model in <model-viewer>, loaded when the guest picks
// 3D (never with the menu). "View on your table · AR" shows when the phone
// can place it in the room: the USDZ on iPhone, the GLB on Android.
function Model({ files, photo, name }: { files: { glb: string; usdz: string | null }; photo: Photo; name: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed" | "nowebgl">(() => (hasWebGL() ? "loading" : "nowebgl"));
  const host = useRef<HTMLDivElement>(null);
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
          "touch-action": "none",
          "auto-rotate": "",
          "shadow-intensity": "1",
          "camera-orbit": "0deg 62deg auto",
          loading: "eager",
          "data-model-viewer": "",
        };
        if (files.usdz) attrs["ios-src"] = files.usdz;
        if (reducedMotion()) delete attrs["auto-rotate"];
        for (const [k, v] of Object.entries(attrs)) viewer.setAttribute(k, v);
        viewer.style.width = "100%";
        viewer.style.height = "100%";
        viewer.style.background = "transparent";
        viewer.style.setProperty("--poster-color", "transparent");
        const ar = document.createElement("button");
        ar.slot = "ar-button";
        ar.type = "button";
        ar.textContent = T.viewOnTable;
        ar.setAttribute("data-view-on-table", "");
        ar.className = css.ghost;
        Object.assign(ar.style, { position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" });
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
  }, [live, files.glb, files.usdz, name]);

  if (state === "failed" || state === "nowebgl") {
    return (
      <>
        <Plate photo={photo} name={name} className={css.stagePlate} />
        <p data-item-media-note className={css.stageNote}>
          {state === "nowebgl" ? S.noWebgl : S.model3dFailed}
        </p>
      </>
    );
  }
  return (
    <>
      {state === "loading" && photo && <Plate photo={photo} name={name} className={css.stagePlate} />}
      <div ref={host} data-model={state} className={css.modelBox} style={state === "loading" ? { opacity: 0 } : undefined} />
      {state === "loading" && <span className={css.stageNote}>{S.loading3d}</span>}
    </>
  );
}

export default function ShowcaseStage({
  item,
  mode,
  onMode,
  lighter,
  showSwitch,
  onClose,
  say,
}: {
  item: PublicMenuItem;
  mode: StageMode;
  onMode: (mode: StageMode) => void;
  lighter: boolean;
  // Off when nothing on the menu has a 360° or 3D view.
  showSwitch: boolean;
  onClose: () => void;
  say: (text: string) => void;
}) {
  const degRef = useRef<HTMLSpanElement>(null);
  const has = { photo: true, spin: !!item.spinFrames && !lighter, model: !!item.modelFiles && !lighter };
  const shown: StageMode = has[mode] ? mode : "photo";
  const hint =
    shown === "spin"
      ? T.hintSpin
      : shown === "model"
        ? T.hintModel
        : lighter && (item.spinFrames || item.modelFiles)
          ? T.lighterOn
          : has.spin && has.model
            ? T.hintPhoto
            : has.spin
              ? T.hintPhotoSpin
              : has.model
                ? T.hintPhotoModel
                : T.hintPhotoOnly;
  const label = { photo: T.photo, spin: T.spin, model: T.model };
  return (
    <div className={css.stage} data-stage={shown}>
      {shown === "photo" && <Plate photo={item.photo} name={item.name} className={css.stagePlate} style={showSwitch ? undefined : { marginBottom: 0 }} />}
      {shown === "spin" && item.spinFrames && <Spin key={item.id} frames={item.spinFrames} photo={item.photo} name={item.name} degRef={degRef} />}
      {shown === "model" && item.modelFiles && <Model key={item.id} files={item.modelFiles} photo={item.photo} name={item.name} />}

      <button type="button" aria-label={S.close} data-item-close className={css.stageClose} onClick={onClose}>
        ×
      </button>
      {showSwitch && <span className={css.modeTitle}>{shown === "photo" ? T.photoTitle : shown === "spin" ? T.spinTitle : T.modelTitle}</span>}
      {shown === "spin" && (
        <span ref={degRef} className={css.degrees} aria-hidden>
          0°
        </span>
      )}

      {showSwitch && (
        <div className={css.stageFoot}>
          <span className={css.stageHint}>{hint}</span>
          <div className={css.modes} role="group" aria-label={T.photo}>
            {(["photo", "spin", "model"] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-view={m}
                aria-pressed={shown === m}
                data-available={has[m]}
                aria-disabled={!has[m]}
                className={css.mode}
                onClick={() => (has[m] ? onMode(m) : say(lighter && (m === "spin" ? item.spinFrames : item.modelFiles) ? T.lighterOn : T.notAvailable(label[m])))}
              >
                {label[m]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
