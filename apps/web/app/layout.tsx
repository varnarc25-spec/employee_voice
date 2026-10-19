import type { ReactNode } from "react";

export const metadata = {
  title: "Employee Voice India",
  description: "Public web skeleton for Employee Voice India.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Georgia, serif", background: "#F6F9FC", color: "#102B4A" }}>{children}</body>
    </html>
  );
}
