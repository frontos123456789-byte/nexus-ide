"use client";

import dynamic from "next/dynamic";
import { BootScreen } from "@/components/ide/Layout/BootScreen";

const CodeStudio = dynamic(() => import("./CodeStudio").then((m) => m.CodeStudio), { ssr: false, loading: () => <BootScreen /> });

export function CodeStudioClient() {
  return <CodeStudio />;
}
