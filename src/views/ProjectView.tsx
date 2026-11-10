import { deleteProject, getProject, saveProject } from '../db';
import { useLive } from '../hooks';
import { deadlineInfo, formatDate, formatPersianDate } from '../lib/stats';
import { navigate } from '../router';
import { directionLabel, type Project } from '../types';
import { confirmDialog, errorMessage, toast } from '../ui';
import { ProjectForm } from './ProjectForm';

const TABS: { id: string; label: string }[] = [{ id: 'settings', label: 'Project settings' }];

interface Props {
  id: string;
  tab: string;
  query: URLSearchParams;
}

export function ProjectView({ id, tab }: Props) {
  const project = useLive(async () => (await getProject(id)) ?? null, ['projects'], [id]);

  if (project === undefined) return <div class="card muted">Loading…</div>;
  if (project === null) {
    return (
      <div class="card empty-state">
        <h3>Project not found</h3>
        <div>It may have been deleted, or it belongs to another browser profile.</div>
        <div class="row">
          <a class="btn primary" href="#/">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const activeTab = TABS.some((t) => t.id === tab) ? tab : TABS[0].id;
  const deadline = deadlineInfo(project.deadline);

  const toggleDelivered = async () => {
    try {
      const status = project.status === 'active' ? 'delivered' : 'active';
      await saveProject({ ...project, status });
      toast(status === 'delivered' ? 'Project marked as delivered.' : 'Project reopened.', 'success');
    } catch (error) {
      toast(`Could not update the project: ${errorMessage(error)}`, 'error');
    }
  };

  return (
    <div>
      <div class="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 dir="auto">{project.name}</h1>
          <div class="row page-sub">
            <span dir="auto">{project.client || 'No client'}</span>
            <span class="badge accent">{directionLabel(project.direction)}</span>
            {project.status === 'delivered' ? (
              <span class="badge ok">Delivered</span>
            ) : (
              deadline.days !== null && <span class={`badge ${deadline.tone}`}>{deadline.label}</span>
            )}
            {project.deadline && (
              <span class="small">
                {formatDate(project.deadline)} ·{' '}
                <span lang="fa" dir="rtl">
                  {formatPersianDate(project.deadline)}
                </span>
              </span>
            )}
          </div>
        </div>
        <div class="actions">
          <button class="btn" onClick={toggleDelivered}>
            {project.status === 'active' ? 'Mark as delivered' : 'Reopen project'}
          </button>
        </div>
      </div>

      <nav class="tabs" aria-label="Project sections">
        {TABS.map((t) => (
          <a key={t.id} class={`tab ${t.id === activeTab ? 'active' : ''}`} href={`#/project/${project.id}/${t.id}`}>
            {t.label}
          </a>
        ))}
      </nav>

      {activeTab === 'settings' && <ProjectSettings project={project} />}
    </div>
  );
}

function ProjectSettings({ project }: { project: Project }) {
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete project?',
      message: `“${project.name}” and all of its segments and media will be deleted. Translation memory entries created from it are kept. This cannot be undone.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(project.id);
      toast('Project deleted.', 'success');
      navigate('/');
    } catch (error) {
      toast(`Could not delete the project: ${errorMessage(error)}`, 'error');
    }
  };

  return (
    <div class="stack">
      <div class="card">
        <div class="card-title">
          <h2>Project details</h2>
        </div>
        <ProjectForm
          key={project.id}
          initial={project}
          submitLabel="Save changes"
          onSaved={() => toast('Project saved.', 'success')}
        />
      </div>
      <div class="card">
        <div class="card-title">
          <h2>Delete project</h2>
        </div>
        <p class="muted">Removes the project, its segments and its stored media from this browser.</p>
        <button class="btn danger" onClick={remove}>
          Delete this project…
        </button>
      </div>
    </div>
  );
}
