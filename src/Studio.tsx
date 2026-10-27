import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { loadLibrary, send, type Item, type Light } from './model';
import type { Request, Response } from '../shared/protocol/src/index';
import { StudioPortalContext } from '../studio/context';

const StudioEditor = lazy(() => import('../studio/src'));

export type StudioConnection = {
  target: string;
  name: string;
  item?: Item;
  request: (request: Request) => Promise<Response>;
};

export function Studio({ light, item, close, notice }: { light: Light; item?: Item; close: () => void; notice: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeAction = useRef<(() => Promise<void>) | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [connection] = useState<StudioConnection>(() => ({
    target: `luxio://${encodeURIComponent(light.simulator ? light.id : light.state.deviceId)}`,
    name: light.state.config.name,
    item,
    request: async ({ id: _id, ...request }) => {
      const result = await send(light, request);
      if ([7, 8, 9].includes(request.operation)) await loadLibrary(light);
      return result;
    },
  }));
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.current?.close();
      void loadLibrary(light).catch(error => notice(String(error)));
    };
  }, []);
  return <dialog className="studio-overlay" aria-label="Animation Studio" ref={dialog} onCancel={event => { event.preventDefault(); if (closeAction.current) void closeAction.current(); else close(); }}>
    <div className="studio-scope dark" ref={setContainer}>
      <Suspense fallback={<div className="studio-loading"><button className="icon-button" aria-label="Close Studio" onClick={close}><X size={20} /></button><LoaderCircle size={24} className="spinning" role="status" aria-label="Loading Studio" /></div>}>
        {container && <StudioPortalContext.Provider value={container}><StudioEditor connection={connection} close={close} closeAction={closeAction} /></StudioPortalContext.Provider>}
      </Suspense>
    </div>
  </dialog>;
}
