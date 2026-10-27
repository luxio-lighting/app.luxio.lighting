import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { loadLibrary, send, type Item, type Light } from './model';
import type { Request, Response } from '../shared/protocol/src/index';

export type StudioBridge = {
  target: string;
  name: string;
  item?: Item;
  request: (request: Request) => Promise<Response>;
  dismiss: () => void;
  requestClose?: () => Promise<void>;
};

export function Studio({ light, item, close, notice }: { light: Light; item?: Item; close: () => void; notice: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const bridge = useRef<StudioBridge | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const host = window as Window & { luxioStudio?: StudioBridge };
    const connection: StudioBridge = {
      target: `luxio://${encodeURIComponent(light.simulator ? light.id : light.state.deviceId)}`,
      name: light.state.config.name,
      item,
      request: async ({ id: _id, ...request }) => {
        const result = await send(light, request);
        if ([7, 8, 9].includes(request.operation)) await loadLibrary(light);
        return result;
      },
      dismiss: close,
    };
    host.luxioStudio = connection; bridge.current = connection;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal(); setReady(true);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (host.luxioStudio === connection) delete host.luxioStudio;
      dialog.current?.close();
      void loadLibrary(light).catch(error => notice(String(error)));
    };
  }, []);
  return <dialog className="studio-overlay" aria-label="Animation Studio" ref={dialog} onCancel={event => { event.preventDefault(); if (bridge.current?.requestClose) void bridge.current.requestClose(); else close(); }}>
    {!loaded && <div className="studio-loading"><button className="icon-button" aria-label="Close Studio" onClick={close}><X size={20} /></button><LoaderCircle size={24} className="spinning" role="status" aria-label="Loading Studio" /></div>}
    {ready && <iframe title="Luxio Studio animation editor" src="/studio/index.html" onLoad={() => setLoaded(true)} />}
  </dialog>;
}
