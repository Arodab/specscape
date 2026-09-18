import { useEffect, useMemo } from 'react';
import type { SpecResult } from '../sim/types';

interface Props {
  row: SpecResult;
  /** The same plan measured with Lightbearer, when that comparison is on. */
  lb?: SpecResult | null;
  /** Baseline row, so the popup can show what the plan is actually worth. */
  baseline: SpecResult | null;
  /** Which encounter the figures are for, or null for the whole sequence. */
  encounterName: string | null;
  onClose: () => void;
}

const TICK_SECONDS = 0.6;
const secs = (ticks: number) => ticks * TICK_SECONDS;
const fmt = (ticks: number) => `${secs(ticks).toFixed(1)}s`;

/**
 * The distribution behind a row's average.
 *
 * The table ranks on the mean, which says nothing about consistency - and
 * consistency is half the decision. A plan that leans on a low-probability
 * spec can match another's average while being far swingier, and the only way
 * to see that is the spread and the tail.
 */
export default function DistributionModal({ row, lb, baseline, encounterName, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = row.stats;

  const chart = useMemo(() => {
    const bars = row.hist;
    if (!bars.length) return null;

    const width = 520;
    const height = 160;
    const peak = Math.max(...bars.map((b) => b.count), 1);
    const step = width / bars.length;
    const lo = bars[0].tick;
    const hi = bars[bars.length - 1].tick;
    const span = hi - lo || 1;
    /** Where a tick value sits along the x axis. */
    const x = (tick: number) => ((tick - lo) / span) * (width - step) + step / 2;

    return { bars, width, height, peak, step, x };
  }, [row.hist]);

  /** Coefficient of variation: spread as a share of the average. */
  const spread = s.mean > 0 ? s.stdDev / s.mean : 0;

  const rows: [string, string, string?][] = [
    ['Mean', fmt(s.mean)],
    ['Median', fmt(s.median)],
    ['Std deviation', fmt(s.stdDev), `${(spread * 100).toFixed(1)}% of the mean`],
    ['Fastest', fmt(s.min)],
    ['Slowest', fmt(s.max)],
  ];

  const quantiles: [string, number][] = [
    ['5%', s.p5], ['10%', s.p10], ['25%', s.p25], ['50%', s.median],
    ['75%', s.p75], ['90%', s.p90], ['95%', s.p95], ['99%', s.p99],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 100%)' }}>
        <header className="modal-head">
          <h3>{row.planName}</h3>
          <button className="link" onClick={onClose}>close</button>
        </header>

        <p className="modal-note">
          {s.samples.toLocaleString()} simulated {encounterName ? `${encounterName} kills` : 'kills'}
          {baseline && row.planId !== baseline.planId
            ? ` - ${row.secondsSaved >= 0 ? 'saving' : 'losing'} ${Math.abs(row.secondsSaved).toFixed(1)}s per kill versus no spec.`
            : '.'}
        </p>

        {chart && (
          <svg
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            style={{ width: '100%', height: 'auto', display: 'block', margin: '4px 0 2px' }}
            role="img"
            aria-label="Distribution of simulated kill times"
          >
            {chart.bars.map((b, i) => {
              const h = (b.count / chart.peak) * (chart.height - 24);
              return (
                <rect
                  key={i}
                  x={i * chart.step + 0.5}
                  y={chart.height - 20 - h}
                  width={Math.max(1, chart.step - 1)}
                  height={h}
                  fill="var(--accent)"
                  opacity={0.75}
                >
                  <title>{`${fmt(b.tick)} - ${b.count} kills`}</title>
                </rect>
              );
            })}

            {/* Median and the 90th percentile: the typical kill, and the bad tail. */}
            {[
              { at: s.median, label: 'median', dash: '0' },
              { at: s.p90, label: 'p90', dash: '3 3' },
            ].map(({ at, label, dash }) => (
              <g key={label}>
                <line
                  x1={chart.x(at)} x2={chart.x(at)} y1={2} y2={chart.height - 20}
                  stroke="var(--text)" strokeWidth={1} strokeDasharray={dash} opacity={0.65}
                />
                <text
                  x={chart.x(at) + 3} y={11}
                  fill="var(--muted)" fontSize={9}
                >
                  {label}
                </text>
              </g>
            ))}

            <line
              x1={0} x2={chart.width} y1={chart.height - 20} y2={chart.height - 20}
              stroke="var(--line)" strokeWidth={1}
            />
            <text x={0} y={chart.height - 7} fill="var(--muted)" fontSize={10}>
              {fmt(chart.bars[0].tick)}
            </text>
            <text
              x={chart.width} y={chart.height - 7}
              fill="var(--muted)" fontSize={10} textAnchor="end"
            >
              {fmt(chart.bars[chart.bars.length - 1].tick)}
            </text>
          </svg>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '10px' }}>
          <table className="dist-table">
            <tbody>
              {rows.map(([label, value, note]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>
                    {value}
                    {note && <span style={{ color: 'var(--muted)', fontSize: '11px' }}> ({note})</span>}
                  </td>
                </tr>
              ))}
              {lb && (
                <tr>
                  <th>Lightbearer mean</th>
                  <td>{lb.meanSeconds.toFixed(1)}s</td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="dist-table">
            <tbody>
              {quantiles.map(([label, ticks]) => (
                <tr key={label}>
                  <th>{label} of kills under</th>
                  <td>{fmt(ticks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="modal-note" style={{ marginTop: '10px' }}>
          Half your kills land inside {fmt(s.p25)}-{fmt(s.p75)}; one in ten takes
          longer than {fmt(s.p90)}.
        </p>
      </div>
    </div>
  );
}
