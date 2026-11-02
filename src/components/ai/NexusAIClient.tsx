"use client";

import dynamic from "next/dynamic";
import { BootScreen } from "@/components/ide/Layout/BootScreen";

// Chat history lives in IndexedDB: render on the client only.
const NexusAI = dynamic(() => import("./NexusAI").then((m) => m.NexusAI), { ssr: false, loading: () => <BootScreen /> });

export function NexusAIClient() {
  return <NexusAI />;
}
