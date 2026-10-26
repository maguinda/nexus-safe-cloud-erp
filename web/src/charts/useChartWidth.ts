import { useEffect, useRef, useState } from 'react';

/**
 * Mide el ancho real del contenedor del gráfico. El SVG se dibuja en píxeles reales (no se escala con un viewBox fijo),
 * así el texto es de 11 px o más también a 320 px. En el servidor y en las pruebas (sin medida) se usa `initial`.
 */
export function useChartWidth(initial = 640): { ref: React.RefObject<HTMLDivElement | null>; width: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number) => setWidth((prev) => { const next = Math.max(160, Math.floor(w)); return Number.isFinite(next) && Math.abs(next - prev) >= 1 ? next : prev; });
    apply(el.getBoundingClientRect().width || initial);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) apply(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return { ref, width };
}
