import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '../ui';

/**
 * Gráficos SVG/HTML livianos para el tablero (sin dependencias externas).
 * Paleta categórica validada (CVD y contraste): serie 1 azul, serie 2 naranja.
 */
export const SERIES = ['#2a78d6', '#eb6834'] as const;

export interface Column<T> {
  label: string;
  value: (row: T) => string | number | null;
  /** Formato para la tabla en pantalla (el CSV usa el valor crudo). */
  format?: (row: T) => ReactNode;
  numeric?: boolean;
}

function csvCell(value: string | number | null) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value).replace('.', ',') : value;
  return /[";\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

/** CSV con separador ";" y coma decimal (abre directo en Excel con configuración regional es-AR). */
export function toCsv<T>(rows: T[], columns: Column<T>[]) {
  const lines = [columns.map(c => csvCell(c.label)).join(';'), ...rows.map(r => columns.map(c => csvCell(c.value(r))).join(';'))];
  return '﻿' + lines.join('\r\n');
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(entries => setWidth(entries[0]!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(s => s * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
}

const compact = (value: number) =>
  new Intl.NumberFormat('es-AR', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);

export function DataTable<T>({ rows, columns, caption }: { rows: T[]; columns: Column<T>[]; caption: string }) {
  if (!rows.length) return <p className="muted">Sin datos para el período seleccionado.</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map(c => <th key={c.label} className={c.numeric ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.label} className={c.numeric ? 'num' : undefined}>
                  {c.format ? c.format(row) : (() => {
                    const v = c.value(row);
                    return v === null ? '—' : typeof v === 'number' ? formatNumber(v) : v;
                  })()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tarjeta de gráfico con alternancia gráfico/tabla y exportación CSV del conjunto que muestra. */
export function ChartCard<T>({ title, subtitle, rows, columns, filename, children, actions }: {
  title: string;
  subtitle?: ReactNode;
  rows: T[];
  columns: Column<T>[];
  filename: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className="card chart-card" aria-label={title}>
      <header className="chart-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted chart-subtitle">{subtitle}</p>}
        </div>
        <div className="chart-actions">
          {actions}
          <button type="button" className="secondary small" onClick={() => setTable(v => !v)} aria-pressed={table}>
            {table ? 'Ver gráfico' : 'Ver tabla'}
          </button>
          <button type="button" className="secondary small" disabled={!rows.length}
            onClick={() => download(filename + '.csv', toCsv(rows, columns), 'text/csv;charset=utf-8')}>
            CSV
          </button>
        </div>
      </header>
      {table ? <DataTable rows={rows} columns={columns} caption={title} /> : rows.length ? children : <p className="muted">Sin datos para el período seleccionado.</p>}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card stat-tile">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint && <p className="muted stat-hint">{hint}</p>}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="chart-legend">
      {items.map(item => (
        <li key={item.name}>
          <span className="swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.name}
          {item.value !== undefined && <strong>{item.value}</strong>}
        </li>
      ))}
    </ul>
  );
}

/** Columnas apiladas (una por categoría del eje X) con tooltip por columna. */
export function StackedColumns({ data, series, height = 240, unit }: {
  data: { label: string; values: number[] }[];
  series: { name: string; color: string }[];
  height?: number;
  unit: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const margin = { top: 22, right: 8, bottom: 28, left: 44 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const totals = data.map(d => d.values.reduce((s, v) => s + v, 0));
  const max = niceMax(Math.max(...totals, 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(4, Math.min(24, band * 0.6));
  const y = (v: number) => margin.top + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(56 / Math.max(band, 1)));
  const peak = totals.indexOf(Math.max(...totals));
  const GAP = 2;
  return (
    <div className="chart-plot" ref={ref} onMouseLeave={() => setActive(null)}>
      <Legend items={series} />
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Columnas apiladas en ${unit}`}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} className="grid-line" />
              <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="axis-text">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = margin.left + band * i + band / 2;
            let base = y(0);
            const visible = d.values.map((v, s) => ({ v, s })).filter(p => p.v > 0);
            return (
              <g key={d.label}>
                {active === i && <rect x={cx - band / 2} y={margin.top} width={band} height={plotH} className="hover-band" />}
                {visible.map(({ v, s }, k) => {
                  const h = (v / max) * plotH;
                  const top = k === visible.length - 1;
                  const gap = k > 0 ? GAP : 0;
                  const segH = Math.max(0, h - gap);
                  const x0 = cx - barW / 2;
                  const y0 = base - gap - segH;
                  base = y0;
                  const r = top ? Math.min(4, segH, barW / 2) : 0;
                  const path = `M${x0},${y0 + segH} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} L${x0 + barW - r},${y0} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} L${x0 + barW},${y0 + segH} Z`;
                  return <path key={s} d={path} fill={series[s]!.color} />;
                })}
                {i === peak && totals[i]! > 0 && (
                  <text x={cx} y={y(totals[i]!) - 6} textAnchor="middle" className="value-text">{compact(totals[i]!)}</text>
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="axis-text">{d.label}</text>
                )}
                <rect x={cx - band / 2} y={margin.top} width={band} height={plotH} fill="transparent" tabIndex={0}
                  aria-label={`${d.label}: ${series.map((s, k) => `${s.name} ${formatNumber(d.values[k] ?? 0)}`).join(', ')}`}
                  onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
              </g>
            );
          })}
          <line x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} className="axis-line" />
        </svg>
      )}
      {active !== null && data[active] && (
        <div className="chart-tooltip" role="status"
          style={{ left: Math.min(Math.max(margin.left + band * active + band / 2, 90), width - 90), top: y(totals[active]!) + 30 }}>
          <strong>{data[active].label}</strong>
          {series.map((s, k) => (
            <span key={s.name}><i className="swatch" style={{ background: s.color }} />{s.name}: {formatNumber(data[active]!.values[k] ?? 0)}</span>
          ))}
          <span className="muted">Total: {formatNumber(totals[active]!)} {unit}</span>
        </div>
      )}
    </div>
  );
}

/** Barras horizontales de una serie, con valor en la punta y tooltip con detalle. */
export function BarList({ data, format = formatNumber, color = SERIES[0], label }: {
  data: { label: string; value: number; detail?: string[] }[];
  format?: (value: number) => string;
  color?: string;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...data.map(d => d.value), 0) || 1;
  return (
    <ul className="bar-list" aria-label={label} onMouseLeave={() => setActive(null)}>
      {data.map((d, i) => (
        <li key={d.label} tabIndex={0} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
          className={active === i ? 'active' : undefined} aria-label={`${d.label}: ${format(d.value)}${d.detail ? '. ' + d.detail.join('. ') : ''}`}>
          <span className="bar-label">{d.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: color }}>
              <span className="bar-value">{format(d.value)}</span>
            </span>
          </span>
          {active === i && d.detail && (
            <span className="chart-tooltip bar-tooltip" role="status">
              <strong>{d.label}</strong>
              {d.detail.map(line => <span key={line}>{line}</span>)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Una totalidad partida en dos o más partes (p. ej. adjudicaciones con y sin consorcio). */
export function SegmentedBar({ parts }: { parts: { name: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const pct = (v: number) => total ? `${Math.round((v / total) * 100)} %` : '—';
  return (
    <div className="segmented">
      <div className="segmented-bar" role="img" aria-label={parts.map(p => `${p.name}: ${p.value} (${pct(p.value)})`).join(', ')}>
        {parts.filter(p => p.value > 0).map(p => (
          <span key={p.name} style={{ flexGrow: p.value, background: p.color }} title={`${p.name}: ${formatNumber(p.value)} (${pct(p.value)})`} />
        ))}
      </div>
      <Legend items={parts.map(p => ({ name: p.name, color: p.color, value: `${formatNumber(p.value)} · ${pct(p.value)}` }))} />
    </div>
  );
}
