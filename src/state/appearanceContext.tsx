import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  applyAppearance,
  getInitialAppearance,
  type Appearance,
} from "../lib/appearance";

interface AppearanceCtx {
  mode: Appearance;
  setMode: (mode: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceCtx>({
  mode: "terminal",
  setMode: () => {},
});

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Appearance>(() => getInitialAppearance());

  // Reflect to <html data-appearance="…"> + localStorage on every change so
  // CSS rules fire instantly when the user toggles in Settings.
  useEffect(() => {
    applyAppearance(mode);
  }, [mode]);

  return (
    <AppearanceContext.Provider value={{ mode, setMode }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): Appearance {
  return useContext(AppearanceContext).mode;
}

export function useSetAppearance(): (mode: Appearance) => void {
  return useContext(AppearanceContext).setMode;
}

/**
 * Override the appearance mode for a subtree without disturbing the global
 * setting. Used by each SessionNode so the user can mix terminal and chat
 * cells on the same canvas — pass an `override` and that cell + its
 * Composer / Message / MessageList descendants see the override; pass null
 * and they fall back to whatever the global setting is.
 */
export function SessionAppearanceProvider({
  override,
  children,
}: {
  override: Appearance | null;
  children: ReactNode;
}) {
  const parent = useContext(AppearanceContext);
  if (!override) return <>{children}</>;
  // The wrapper class is what CSS selectors (.appearance-chat .chat-md, etc.)
  // bind to. `display: contents` keeps it out of the layout flow so the
  // session card's flex layout is unaffected.
  return (
    <AppearanceContext.Provider value={{ mode: override, setMode: parent.setMode }}>
      <div className={`appearance-${override} contents`}>{children}</div>
    </AppearanceContext.Provider>
  );
}
