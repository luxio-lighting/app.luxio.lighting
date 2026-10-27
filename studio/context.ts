import { createContext } from 'react';

// Keep menus and nested dialogs inside the fullscreen Studio and its styles.
export const StudioPortalContext = createContext<HTMLElement | null>(null);
