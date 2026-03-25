export function SectionTitle({
  eyebrow,
  title,
  body
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "#0f766e",
          fontWeight: 700
        }}
      >
        {eyebrow}
      </p>
      <h2 style={{ marginBottom: 8, fontSize: 24 }}>{title}</h2>
      <p style={{ margin: 0, color: "#475569", maxWidth: 760 }}>{body}</p>
    </div>
  );
}
