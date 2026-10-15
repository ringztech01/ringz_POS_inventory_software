import { Package } from "lucide-react";
import { COLORS } from "@/components/layout/theme";

function Placeholder({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
        backgroundColor: COLORS.bgInput,
        backgroundImage: `repeating-linear-gradient(135deg, ${COLORS.border} 0 6px, transparent 6px 12px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.slateLight,
      }}
    >
      <Package size={size * 0.2} strokeWidth={1.6} />
    </div>
  );
}

export default function ProductImageGallery({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <Placeholder size={160} />;
  }

  const [main, ...rest] = images;

  return (
    <div style={{ display: "flex", gap: 12 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={main}
        alt=""
        style={{
          width: 160,
          height: 160,
          borderRadius: 12,
          objectFit: "cover",
          border: `1px solid ${COLORS.border}`,
        }}
      />
      {rest.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start", maxWidth: 300 }}>
          {rest.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${src}-${index}`}
              src={src}
              alt=""
              style={{
                width: 64,
                height: 64,
                borderRadius: 8,
                objectFit: "cover",
                border: `1px solid ${COLORS.border}`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
