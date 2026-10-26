# Librería de gráficos (`src/charts`)

Gráficos SVG propios, **sin dependencias**. Importa todo de `../charts`. Reglas que cumple cada uno:

- **Nunca solo color:** todo gráfico tiene resumen para el lector de pantalla (`ariaLabel`, obligatorio), leyenda cuando hay 2 o más series, etiquetas directas y una tabla alternativa (`ChartCard` → «Ver como tabla»).
- **Teclado:** el gráfico recibe foco; ← → (y ↑ ↓) recorren los puntos, Inicio/Fin saltan, Escape suelta. La lectura se anuncia (`aria-live`).
- **Se dibuja en píxeles reales** (mide su contenedor), así el texto es de 11 px o más también a 320 px.
- **Colores:** solo tokens (`--chart-1..6`, `--chart-other`, `--chart-seq`, y los de la app) en `styles/charts.css`, con oscuro por `:root[data-theme="dark"]` y por el sistema. Paleta validada con el validador de dataviz (los 6 tonos, claro y oscuro). El 7.º elemento **no** recibe un color: se agrupa en «Otros» (`foldSlices`, `seriesTone`).
- **Los textos y el idioma** entran por props (`lang` y, si hace falta, `t`); los componentes **no** leen la sesión. En una pantalla: `const { lang, t } = useSession()` y se pasan.
- Un valor que no sea un número finito (`NaN`, `Infinity`, `null`) no se dibuja: se descarta.
- Las etiquetas de series y categorías entran como texto de React (nunca como HTML).

## Envolver siempre en `ChartCard`

```tsx
const table = lineChartTable(series, { lang, yFormat: fmt });
<ChartCard lang={lang} t={t} title="Temperatura por oficina" subtitle="13 sep 2026, 08:01–11:20 UTC" table={table}
  state={data ? (series.length ? 'ready' : 'empty') : 'loading'} footnote="Datos de la carpeta PROYECTO_NEXUS">
  <LineChart lang={lang} series={series} thresholds={[{ y: 24, label: 'Umbral 24 °C' }]} yFormat={fmt} ariaLabel="La Oficina 3 supera 24 °C desde las 10:44" />
</ChartCard>
```
`state`: `ready` (dibuja `children`), `empty` («Sin datos»), `loading` (esqueleto), `error`. `headingLevel` cambia el nivel del título (2–4). Cada gráfico tiene su generador de tabla: `lineChartTable`, `barChartTable`, `donutTable`, `heatmapTable`.

## Componentes

**`LineChart`** — `series: {id,label,points:{x,y}[],tone?,dashed?,area?}[]`, `thresholds?: {y,label}[]`, `band?: {label,tone?,points:{x,lower,upper}[]}`, `markers?: {x,y,label,tone?}[]` (eventos: rombos), `xKind?: 'time'|'index'` (en `'time'`, `x` son milisegundos UTC), `xLabel?`, `yFormat?`, `yDomain?: {min?,max?,includeZero?}`, `ariaLabel`, `height?`.
```tsx
<LineChart lang={lang} series={[{ id: 'o1', label: 'Oficina 1', points: [{ x: Date.parse('2026-09-13T08:01:00Z'), y: 22.4 } /* … */] }]}
  band={{ label: 'Mín–máx', points }} markers={[{ x, y: 24, label: 'Advertencia' }]} ariaLabel="…" />
```

**`BarChart`** — `categories: {id,label,shortLabel?}[]`, `series: {id,label,tone?,values:(number|null)[]}[]` (un valor por categoría), `orientation?: 'vertical'|'horizontal'`, `stacked?`, `showValues?` (por defecto sí hasta 14 barras), `valueFormat?`, `max?`, `ariaLabel`, `height?`. Barras de 24 px como máximo, extremo del dato redondeado a 4 px, 2 px de aire entre las que se tocan, eje siempre desde cero.
```tsx
<BarChart lang={lang} orientation="horizontal" categories={cats} series={[{ id: 'n', label: 'Equipos', values }]} ariaLabel="Hay 36 laptops, 11 PC y 5 switches de acceso" />
```

**`Donut`** — `slices: {id,label,value,tone?}[]`, `ariaLabel`, `centerValue?`, `centerLabel?`, `valueFormat?`, `size?`. Total al centro y leyenda con valor y porcentaje; pasar el cursor por una porción muestra la suya. `foldSlices(slices, 'Otros', 6)` agrupa lo que pasa de 6.
```tsx
<Donut lang={lang} slices={[{ id: 'c', label: 'Crítica', value: 5 }, { id: 'a', label: 'Alta', value: 5 }, { id: 'm', label: 'Media', value: 66 }]} ariaLabel="…" />
```

**`Gauge`** — `value`, `min?`, `max?`, `bands?: {from,tone:'ok'|'warn'|'bad'}[]`, `valueText?`, `label`, `ariaLabel`, `size?`. El estado se dice con icono y texto (✓ Normal, ! Atención, ✕ Crítico), no solo con el color. `gaugeTone(value, bands)` es la regla pura.
```tsx
<Gauge lang={lang} value={72} bands={[{ from: 0, tone: 'bad' }, { from: 60, tone: 'warn' }, { from: 85, tone: 'ok' }]} valueText="72 %" label="Disponibilidad" ariaLabel="La disponibilidad es de 72 %" />
```

**`Heatmap`** — `rows`, `cols: {id,label}[]`, `values[fila][columna]` (`null` = sin dato, nunca cero), `valueFormat?`, `min?`, `max?`, `showValues?` (por defecto solo si la celda mide 26 px o más), `colEvery?`, `ariaLabel`. Un solo tono de claro a oscuro; el número está en la celda, en el `title` y en la tabla. Navegación con las cuatro flechas.
```tsx
<Heatmap lang={lang} rows={oficinas} cols={horas} values={matriz} ariaLabel="Los eventos se concentran a las 09:40" />
```

**`Delta`** — chip ▲ ▼ ▬ con el porcentaje. `previous`/`current` (o `pct` ya calculado), `goodWhen?: 'up'|'down'|'neutral'` (**que la temperatura suba es malo: `goodWhen="down"`**), `flatBelow?`, `showVs?`. Sin comparación posible (anterior 0 o ausente) muestra «—».
```tsx
<Delta lang={lang} previous={22.1} current={23.4} goodWhen="down" showVs />
```

**`Sparkline`** — `values`, `tone?`, `width?`, `height?`, `ariaLabel`, `area?`. Mini línea para tarjetas de cifra.
```tsx
<Sparkline values={temps} ariaLabel="La temperatura de la última hora va de 21 a 24 °C" />
```

**`Legend`** — `items: {id,label,tone,shape?:'line'|'box'|'dot',dashed?,value?}[]` (ya la incluyen los gráficos; sirve para tarjetas propias). **`ChartEmpty`** — estado vacío suelto.

## Funciones puras (`scale.ts`, `format.ts`)
`niceTicks`, `niceDomain`, `linearScale`, `timeTicks` (alineado a UTC), `bandLayout`, `linePath`, `areaPath`, `ringPath`, `changePct`, `fraction`, `spreadLabels`; `formatNumber` (1.234,5 en español, 1,234.5 en inglés), `formatTick` (0 / 1K / 2,5K), `formatPercent`, `formatClock`, `formatInstantMs` (todo en UTC).

## Qué no hace (todavía)
Zoom y selección de rango, varias escalas en un gráfico (a propósito: nunca doble eje), animaciones de entrada, exportar como imagen. Se probó la estructura y la lógica con pruebas, y el aspecto con capturas en el PR que los use.
