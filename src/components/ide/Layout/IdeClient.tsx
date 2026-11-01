"use client";

import dynamic from "next/dynamic";
import { BootScreen } from "./BootScreen";

// The IDE depends on IndexedDB, Monaco and window APIs: render it on the client only.
const IdeWorkspace = dynamic(() => import("./IdeWorkspace").then((m) => m.IdeWorkspace), {
  ssr: false,
  loading: () => <BootScreen />,
});

export function IdeClient() {
  return <IdeWorkspace />;
}
