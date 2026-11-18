// Loads <model-viewer> (Part 8 Step 4) — only when a guest taps "View in 3D",
// never with the menu. It isn't part of the page's own bundle at all: the
// package's ready-built file is served from this server
// (/menu/viewer/model-viewer.min.js, from node_modules) and added to the page
// on that tap. Its decoders for compressed models also come from this server
// (/menu/viewer/…: Draco, KTX2, Meshopt), so 3D works on a restaurant
// network with no internet — it would otherwise fetch them from CDNs.
let loading: Promise<void> | null = null;

const SCRIPT = "/menu/viewer/model-viewer.min.js";
type ViewerClass = CustomElementConstructor & { dracoDecoderLocation: string; ktx2TranscoderLocation: string; meshoptDecoderLocation: string };

export function loadModelViewer(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    if (customElements.get("model-viewer")) return resolve();
    const script = document.createElement("script");
    script.type = "module";
    script.src = SCRIPT;
    script.dataset.modelViewerScript = "";
    script.onerror = () => reject(new Error("The 3D viewer couldn't load."));
    document.head.appendChild(script);
    customElements.whenDefined("model-viewer").then(() => resolve(), reject);
  })
    .then(() => {
      const viewer = customElements.get("model-viewer") as ViewerClass | undefined;
      if (!viewer) throw new Error("The 3D viewer isn't there.");
      viewer.dracoDecoderLocation = "/menu/viewer/draco/";
      viewer.ktx2TranscoderLocation = "/menu/viewer/basis/";
      // Meshopt (the menu's compressed models): <model-viewer> turns its
      // decoder on only once this script has loaded.
      viewer.meshoptDecoderLocation = "/menu/viewer/meshopt_decoder.js";
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}
