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
