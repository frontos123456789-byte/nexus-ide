import { Suspense } from "react";
import { NexusAIClient } from "@/components/ai/NexusAIClient";

export const metadata = { title: "AI-чат — Nexus" };

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <NexusAIClient />
    </Suspense>
  );
}
