import { useMemo, useState } from 'preact/hooks';
import { listAllSegments, listProjects } from '../db';
import { useLive } from '../hooks';
import {
  deadlineInfo,
  formatDate,
  formatMoney,
  formatPersianDate,
  projectStats,
  wordsConfirmedInMonth,
  type ProjectStats,
} from '../lib/stats';
import { navigate } from '../router';
import { loadSampleProject } from '../sample';
import { directionLabel, type Project, type Segment } from '../types';
import { errorMessage, ProgressBar, toast } from '../ui';

interface Row {
  project: Project;
  stats: ProjectStats;
}

function DeadlineCell({ project }: { project: Project }) {
  const info = deadlineInfo(project.deadline);
  if (info.days === null) return <span class="muted">—</span>;
  const tone = project.status === 'delivered' ? '' : info.tone === 'none' ? '' : info.tone;
  return (
    <div>
      <div class="nowrap">{formatDate(project.deadline)}</div>
      <div class="small muted" lang="fa" dir="rtl" style={{ textAlign: 'start' }}>
        {formatPersianDate(project.deadline)}
      </div>
      {project.status === 'active' && <span class={`badge ${tone}`}>{info.label}</span>}
    </div>
  );
}

function ProjectTable({ rows }: { rows: Row[] }) {
  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Direction</th>
            <th>Deadline</th>
            <th>Progress</th>
            <th class="num">Words</th>
            <th class="num">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ project, stats }) => (
            <tr
              key={project.id}
              class="clickable"
              tabIndex={0}
              onClick={() => navigate(`/project/${project.id}/editor`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/project/${project.id}/editor`);
              }}
            >
              <td>
                <div dir="auto" style={{ fontWeight: 600 }}>
                  {project.name}
                </div>
                <div class="small muted" dir="auto">
                  {project.client || 'No client'}
                </div>
              </td>
              <td>
                <span class="badge accent">{directionLabel(project.direction)}</span>
              </td>
              <td>
                <DeadlineCell project={project} />
              </td>
              <td style={{ minWidth: '150px' }}>
                <ProgressBar value={stats.progress} />
                <div class="small muted">
                  {stats.confirmed}/{stats.segments} segments confirmed
                </div>
              </td>
              <td class="num">{stats.sourceWords.toLocaleString('en-US')}</td>
              <td class="num nowrap">
                {project.rate > 0 ? `${formatMoney(project.rate, project.currency, 4)} / ${project.rateUnit}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard() {
  const projects = useLive(listProjects, ['projects'], []);
  const segments = useLive(listAllSegments, ['segments'], []);
  const [loadingSample, setLoadingSample] = useState(false);

  const data = useMemo(() => {
    if (!projects || !segments) return null;
    const byProject = new Map<string, Segment[]>();
    for (const segment of segments) {
      const list = byProject.get(segment.projectId);
      if (list) list.push(segment);
      else byProject.set(segment.projectId, [segment]);
    }
    const rows: Row[] = projects.map((project) => ({
      project,
      stats: projectStats(project, byProject.get(project.id) ?? []),
    }));
    const active = rows
      .filter((row) => row.project.status === 'active')
      .sort((a, b) => {
        const da = a.project.deadline || '9999-12-31';
        const db = b.project.deadline || '9999-12-31';
        return da.localeCompare(db);
      });
    const delivered = rows.filter((row) => row.project.status === 'delivered');
    let dueSoon = 0;
    let overdue = 0;
    for (const row of active) {
      const info = deadlineInfo(row.project.deadline);
      if (info.days === null) continue;
      if (info.days < 0) overdue++;
      else if (info.days <= 7) dueSoon++;
    }
    return { active, delivered, dueSoon, overdue, wordsThisMonth: wordsConfirmedInMonth(segments) };
  }, [projects, segments]);

  const addSample = async () => {
    setLoadingSample(true);
    try {
      const id = await loadSampleProject();
      toast('Sample project added.', 'success');
      navigate(`/project/${id}/editor`);
    } catch (error) {
      toast(`Could not create the sample project: ${errorMessage(error)}`, 'error');
    } finally {
      setLoadingSample(false);
    }
  };

  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <div class="page-sub">Your translation and transcription work at a glance.</div>
        </div>
        <div class="actions">
          <button class="btn" onClick={addSample} disabled={loadingSample}>
            Add sample project
          </button>
          <a class="btn primary" href="#/projects/new">
            + New project
          </a>
        </div>
      </div>

      {!data ? (
        <div class="card muted">Loading…</div>
      ) : (
        <div class="stack">
          <div class="stats">
            <div class="stat">
              <div class="stat-value">{data.active.length}</div>
              <div class="stat-label">Active projects</div>
            </div>
            <div class="stat">
              <div class="stat-value">{data.dueSoon}</div>
              <div class="stat-label">Due within 7 days</div>
            </div>
            <div class="stat">
              <div class="stat-value" style={{ color: data.overdue > 0 ? 'var(--danger)' : undefined }}>
                {data.overdue}
              </div>
              <div class="stat-label">Overdue</div>
            </div>
            <div class="stat">
              <div class="stat-value">{data.wordsThisMonth.toLocaleString('en-US')}</div>
              <div class="stat-label">Words translated in {monthName}</div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">
              <h2>Active projects</h2>
              <span class="muted small">sorted by deadline</span>
            </div>
            {data.active.length === 0 ? (
              <div class="empty-state">
                <h3>No active projects</h3>
                <div>Create a project, or add the built-in sample to try every feature.</div>
                <div class="row">
                  <a class="btn primary" href="#/projects/new">
                    + New project
                  </a>
                  <button class="btn" onClick={addSample} disabled={loadingSample}>
                    Add sample project
                  </button>
                </div>
              </div>
            ) : (
              <ProjectTable rows={data.active} />
            )}
          </div>

          {data.delivered.length > 0 && (
            <div class="card">
              <div class="card-title">
                <h2>Delivered</h2>
                <span class="badge">{data.delivered.length}</span>
              </div>
              <ProjectTable rows={data.delivered} />
            </div>
          )}

          <p class="muted small">
            “Words translated” counts the source words of every segment you confirmed during the current calendar
            month, across all projects.
          </p>
        </div>
      )}
    </div>
  );
}
