import { createContext } from 'react';

// Keep menus and nested dialogs inside the Studio popup and its styles.
export const StudioPortalContext = createContext<HTMLElement | null>(null);
