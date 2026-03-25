export function StatusChip({
  value
}: {
  value: string;
}) {
  const palette =
    value === "active" || value === "ready" || value === "qualified"
      ? "rgba(8, 145, 178, 0.14)"
      : value === "sold" || value === "resolved"
        ? "rgba(100, 116, 139, 0.14)"
        : value === "assigned"
          ? "rgba(249, 115, 22, 0.16)"
          : "rgba(59, 130, 246, 0.12)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        background: palette,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "capitalize"
      }}
    >
      {value}
    </span>
  );
}
