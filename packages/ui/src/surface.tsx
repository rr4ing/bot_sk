import type { PropsWithChildren } from "react";

export function Surface({
  title,
  children
}: PropsWithChildren<{ title: string }>) {
  return (
    <section
      style={{
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: 20,
        padding: 20,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.98) 100%)",
        boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)"
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}
