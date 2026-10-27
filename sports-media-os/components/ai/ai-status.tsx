"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Whether AI is switched on for this deployment (AI_ENABLED). Set once in the app layout. */
const AiEnabled = createContext(true);

export function AiStatusProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <AiEnabled value={enabled}>{children}</AiEnabled>;
}

export function useAiEnabled(): boolean {
  return useContext(AiEnabled);
}

/** Renders its children only when AI is on: manual mode shows no AI buttons at all. */
export function AiOnly({ children }: { children: ReactNode }) {
  return useAiEnabled() ? children : null;
}
