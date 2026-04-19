import { secsToHMS } from '../lib/stats'
import type { EpisodeStats } from '../lib/stats'

interface Props {
  title: string
  stats: EpisodeStats
}

export default function SummaryBar({ title, stats }: Props) {
  const totalSecs = stats.roughcutSecs + stats.finecutSecs
  const combinedPct = stats.validScenes > 0
    ? (stats.roughcutScenes + stats.finecutScenes) / stats.validScenes
    : 0

  return (
    <div style={s.bar} className="no-print">
      <div style={s.title}>{title}</div>
      <div style={s.metrics}>
        <Metric label="初剪" pct={stats.roughcutPct} color="#FFC107"
          count={stats.roughcutScenes} total={stats.validScenes} />
        <Metric label="精剪" pct={stats.finecutPct} color="#4CAF50"
          count={stats.finecutScenes} total={stats.validScenes} />
        <Metric label="總計" pct={combinedPct} color="#E5E5E5"
          count={stats.roughcutScenes + stats.finecutScenes} total={stats.validScenes} />
        <div style={s.divider} />
        <div style={s.pill}>
          <span style={s.pillLabel}>總時長</span>
          <span style={s.pillValue}>{secsToHMS(totalSecs)}</span>
        </div>
        <div style={s.pill}>
          <span style={s.pillLabel}>總頁數</span>
          <span style={s.pillValue}>{stats.totalPages.toFixed(1)}</span>
        </div>
      </div>
    </div>
  )
}

interface MetricProps {
  label: string
  pct: number
  color: string
  count: number
  total: number
}

function Metric({ label, pct, color, count, total }: MetricProps) {
  return (
    <div style={s.metric}>
      <span style={s.metricLabel}>{label}</span>
      <div style={s.barTrack}>
        <div style={{ ...s.barFill, width: `${Math.min(pct * 100, 100)}%`, background: color }} />
      </div>
      <span style={s.metricPct}>{Math.round(pct * 100)}%</span>
      <span style={s.metricCount}>{count}/{total}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  bar: {
    position: 'sticky', top: 0, zIndex: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 24, padding: '10px 40px',
    background: 'rgba(20, 20, 20, 0.92)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
    whiteSpace: 'nowrap', flexShrink: 0,
  },
  metrics: {
    display: 'flex', alignItems: 'center', gap: 16,
    flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap',
  },
  metric: {
    display: 'flex', alignItems: 'center', gap: 8,
    minWidth: 160,
  },
  metricLabel: {
    fontSize: 11, color: 'var(--text-secondary)',
    width: 28, flexShrink: 0,
  },
  metricPct: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
    minWidth: 34, textAlign: 'right', flexShrink: 0,
  },
  metricCount: {
    fontSize: 11, color: 'var(--text-secondary)',
    minWidth: 48, textAlign: 'right', flexShrink: 0,
  },
  barTrack: {
    background: '#2A2A2A', borderRadius: 2, height: 4,
    flex: 1, minWidth: 60, overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2, transition: 'width 0.3s ease' },
  divider: {
    width: 1, height: 20, background: '#2A2A2A', flexShrink: 0,
  },
  pill: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
  },
  pillLabel: { fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1 },
  pillValue: {
    fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
    lineHeight: 1, whiteSpace: 'nowrap',
  },
}
