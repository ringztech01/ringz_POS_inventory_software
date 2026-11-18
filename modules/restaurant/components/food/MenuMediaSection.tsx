"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Box, Film, FolderOpen, ImageIcon, Images, RotateCw, Trash2, Upload } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { MEDIA_LIMITS, MODEL_TARGET_BYTES, SPIN_MAX, SPIN_MIN, formatBytes, naturalCompare, type MenuMediaKind, type MenuMediaType } from "../../lib/menuMediaRules";
import { getMenuMediaAction, removeMenuMediaAction, setMenuMediaTypeAction } from "../../server/actions/menuMedia";
import type { MediaResult, MenuMediaView } from "../../server/services/menuMedia";
import { ModelView, SpinView } from "../publicMenu/ItemMedia";

// Food › Menu items › Media (Part 8 Step 5): the item's photo, 360° and 3D
// model, and which one the digital menu shows. Each upload is saved as soon
// as it's done (the server resizes, checks and compresses), apart from the
// item's own Save.

const OFFLINE = "Couldn't reach the server. Check the connection and try again.";
const box: CSSProperties = { border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 };
const small: CSSProperties = { fontSize: 12, color: COLORS.slateMid };

function Btn({ children, onClick, disabled, danger, data }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; data?: string }) {
  return (
    <button
      type="button"
      data-media-action={data}
      onClick={onClick}
      disabled={disabled}
      style={{ height: 32, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: `1px solid ${danger ? COLORS.dangerBorder : COLORS.borderStrong}`, background: disabled ? COLORS.bgApp : "#fff", color: disabled ? COLORS.slateLight : danger ? COLORS.danger : COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </button>
  );
}

// A hidden file input, opened by a button.
function Picker({ accept, multiple, folder, onFiles, children, disabled, data }: { accept: string; multiple?: boolean; folder?: boolean; onFiles: (files: File[]) => void; children: ReactNode; disabled?: boolean; data: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={(el) => {
          input.current = el;
          if (el && folder) el.setAttribute("webkitdirectory", "");
        }}
        type="file"
        accept={accept}
        multiple={multiple || folder}
        data-media-input={data}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Btn onClick={() => input.current?.click()} disabled={disabled} data={data}>
        {children}
      </Btn>
    </>
  );
}

async function post(productId: string, kind: string, file?: File, session?: string): Promise<MediaResult & { session?: string; count?: number }> {
  const body = new FormData();
  if (file) body.append("file", file);
  const response = await fetch(`/restaurant/food/media/${encodeURIComponent(productId)}/${kind}${session ? `?session=${session}` : ""}`, { method: "POST", body });
  return (await response.json()) as MediaResult & { session?: string; count?: number };
}

export default function MenuMediaSection({ productId, name }: { productId: string | null; name: string }) {
  const [media, setMedia] = useState<MenuMediaView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview3d, setPreview3d] = useState(false);

  useEffect(() => {
    if (!productId) return;
    let live = true;
    getMenuMediaAction(productId).then(
      (result) => live && (result.ok ? setMedia(result.media) : toast.error(result.error)),
      () => live && toast.error(OFFLINE),
    );
    return () => {
      live = false;
    };
  }, [productId]);

  if (!productId) {
    return (
      <div data-menu-media style={box}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Media</span>
        <span style={small}>Save the item first, then add its photo, 360° or 3D model here.</span>
      </div>
    );
  }

  const take = (result: MediaResult, success: string) => {
    if (result.ok) {
      setMedia(result.media);
      setNotice(result.notice ?? null);
      toast.success(success);
    } else toast.error(result.error);
  };
  const doing = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch {
      toast.error(OFFLINE);
    }
    setBusy(null);
    setProgress(null);
  };

  const uploadOne = (kind: "photo" | "spin-video" | "model" | "usdz", success: string) => (files: File[]) =>
    doing(kind, async () => {
      if (kind === "spin-video") setProgress("Uploading the video and taking its frames…");
      if (kind === "model") setProgress("Uploading and compressing the model…");
      take(await post(productId, kind, files[0]), success);
    });

  // 360° from images: 24–36 of them, in name order, one upload each.
  const uploadFrames = (files: File[]) =>
    doing("spin", async () => {
      const images = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)).sort((a, b) => naturalCompare(a.name, b.name));
      if (images.length < SPIN_MIN || images.length > SPIN_MAX) {
        toast.error(`A 360° needs ${SPIN_MIN}–${SPIN_MAX} frames; that's ${images.length}.`);
        return;
      }
      const big = images.find((f) => f.size > MEDIA_LIMITS.frame);
      if (big) {
        toast.error(`“${big.name}” is ${formatBytes(big.size)}; ${formatBytes(MEDIA_LIMITS.frame)} at most.`);
        return;
      }
      const started = await post(productId, "spin-start");
      if (!started.ok || !started.session) {
        toast.error(started.ok ? "Couldn't start the upload." : started.error);
        return;
      }
      for (const [i, file] of images.entries()) {
        setProgress(`Uploading frame ${i + 1} of ${images.length}…`);
        const added = await post(productId, "spin-frame", file, started.session);
        if (!added.ok) {
          toast.error(added.error);
          await post(productId, "spin-cancel", undefined, started.session).catch(() => undefined);
          return;
        }
      }
      setProgress("Checking the frames…");
      take(await post(productId, "spin-finish", undefined, started.session), `360° saved: ${images.length} frames.`);
    });

  const remove = (kind: MenuMediaKind, label: string) =>
    doing(`remove-${kind}`, async () => {
      take(await removeMenuMediaAction({ productId, kind }), `${label} removed.`);
    });
  const choose = (type: MenuMediaType) =>
    doing(`type-${type}`, async () => {
      take(await setMenuMediaTypeAction({ productId, type }), "The menu will show this.");
    });

  const disabled = busy !== null || !media;
  const types: [MenuMediaType, string, boolean][] = [
    ["PHOTO", "Photo", true],
    ["SPIN", "360°", !!media?.spinFrames],
    ["MODEL", "3D", !!media?.model],
  ];

  return (
    <div data-menu-media style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Media</span>
        <span style={{ ...small, marginLeft: "auto" }}>The menu shows:</span>
        {types.map(([type, label, ready]) => (
          <label key={type} title={ready ? undefined : `Add the ${label} first`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: ready ? COLORS.text : COLORS.slateLight }}>
            <input type="radio" name="menu-media-type" data-media-type={type} checked={media?.mediaType === type} disabled={disabled || !ready} onChange={() => choose(type)} />
            {label}
          </label>
        ))}
      </div>
      {progress && (
        <span data-media-progress role="status" style={{ fontSize: 12.5, color: COLORS.teal, fontWeight: 600 }}>
          {progress}
        </span>
      )}
      {notice && (
        <span data-media-notice style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "6px 10px" }}>
          {notice}
        </span>
      )}

      <div data-media-photo style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 72, height: 56, borderRadius: 8, background: COLORS.bgApp, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {media?.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the stored WebP thumbnail
              <img data-media-photo-thumb src={media.photo.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <ImageIcon size={18} strokeWidth={1.6} color={COLORS.slateLight} />
            )}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Photo</span>
            <span style={small}>Saved as WebP at 1200 px with a 400 px thumbnail. JPG, PNG or WebP, {formatBytes(MEDIA_LIMITS.photo)} at most.</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Picker accept="image/jpeg,image/png,image/webp" onFiles={uploadOne("photo", "Photo saved.")} disabled={disabled} data="photo">
            <Upload size={14} strokeWidth={1.8} /> {media?.photo ? "Replace photo" : "Upload photo"}
          </Picker>
          {media?.photo && (
            <Btn danger onClick={() => remove("photo", "Photo")} disabled={disabled} data="remove-photo">
              <Trash2 size={14} strokeWidth={1.8} /> Remove
            </Btn>
          )}
        </div>
      </div>

      <div data-media-spin style={box}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <RotateCw size={14} strokeWidth={1.8} /> 360° {media?.spinFrames ? <span data-media-spin-count style={{ ...small, fontWeight: 500 }}>· {media.spinFrames.length} frames</span> : null}
          </span>
          <span style={small}>
            {SPIN_MIN}–{SPIN_MAX} photos taken round the dish, the same size, numbered in order (e.g. dish01 … dish36) — or one short video of a slow turn. Drag the preview to check it.
          </span>
        </div>
        {media?.spinFrames && (
          <div data-media-spin-preview style={{ maxWidth: 360, borderRadius: 8, overflow: "hidden" }}>
            <SpinView frames={media.spinFrames} photo={media.photo} name={name} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Picker accept="image/jpeg,image/png,image/webp" multiple onFiles={uploadFrames} disabled={disabled} data="spin-images">
            <Images size={14} strokeWidth={1.8} /> Choose frames
          </Picker>
          <Picker accept="image/*" folder onFiles={uploadFrames} disabled={disabled} data="spin-folder">
            <FolderOpen size={14} strokeWidth={1.8} /> Upload a folder
          </Picker>
          <Picker accept="video/mp4,video/quicktime,video/webm" onFiles={uploadOne("spin-video", "360° made from the video.")} disabled={disabled} data="spin-video">
            <Film size={14} strokeWidth={1.8} /> From a video
          </Picker>
          {media?.spinFrames && (
            <Btn danger onClick={() => remove("spin", "360°")} disabled={disabled} data="remove-spin">
              <Trash2 size={14} strokeWidth={1.8} /> Remove
            </Btn>
          )}
        </div>
      </div>

      <div data-media-model style={box}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Box size={14} strokeWidth={1.8} /> 3D model
          </span>
          {media?.model ? (
            <span data-media-model-size style={{ fontSize: 12.5, color: media.model.size > MODEL_TARGET_BYTES ? "#92400e" : COLORS.text }}>
              GLB {formatBytes(media.model.size)}
              {media.model.usdz ? ` · USDZ ${formatBytes(media.model.usdzSize ?? 0)}` : " · no USDZ (iPhone builds its own for View on your table)"}
            </span>
          ) : (
            <span style={small}>A GLB (and, for iPhones, a USDZ), {formatBytes(MEDIA_LIMITS.model)} at most. The GLB is compressed here, aiming at {formatBytes(MODEL_TARGET_BYTES)} or less.</span>
          )}
        </div>
        {media?.model && preview3d && (
          <div data-media-model-preview style={{ maxWidth: 360, borderRadius: 8, overflow: "hidden" }}>
            <ModelView files={{ glb: media.model.glb, usdz: media.model.usdz }} photo={media.photo} name={name} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Picker accept=".glb,model/gltf-binary" onFiles={uploadOne("model", "3D model saved.")} disabled={disabled} data="model">
            <Upload size={14} strokeWidth={1.8} /> {media?.model ? "Replace GLB" : "Upload GLB"}
          </Picker>
          {media?.model && (
            <>
              <Picker accept=".usdz,model/vnd.usdz+zip" onFiles={uploadOne("usdz", "USDZ saved.")} disabled={disabled} data="usdz">
                <Upload size={14} strokeWidth={1.8} /> {media.model.usdz ? "Replace USDZ" : "Add USDZ"}
              </Picker>
              {!preview3d && (
                <Btn onClick={() => setPreview3d(true)} disabled={disabled} data="preview-3d">
                  <Box size={14} strokeWidth={1.8} /> Preview
                </Btn>
              )}
              <Btn danger onClick={() => remove("model", "3D model")} disabled={disabled} data="remove-model">
                <Trash2 size={14} strokeWidth={1.8} /> Remove
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
