export default function Footer() {
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 12,
        borderTop: "1px solid #dde2e3",
        marginTop: "auto",
      }}
    >
      <span style={{ fontSize: 12.5, color: "#97a1a4" }}>
        All Rights Reserved (C) 2026 <a href="#top">RingzPOS</a>
      </span>
      <span style={{ fontSize: 12.5, color: "#97a1a4" }}>v1.0</span>
    </footer>
  );
}
