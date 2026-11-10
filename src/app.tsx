import { useEffect, useState } from 'preact/hooks';
import { listProjects } from './db';
import { useLive } from './hooks';
import { navigate, useRoute } from './router';
import { ensureSampleOnFirstRun } from './sample';
import { ConfirmHost, errorMessage, ToastHost } from './ui';
import { Dashboard } from './views/Dashboard';
import { blankProject, ProjectForm } from './views/ProjectForm';
import { ProjectView } from './views/ProjectView';
import { Settings } from './views/Settings';
import { TMView } from './views/TMView';

function NewProject() {
  const [initial] = useState(blankProject);
  return (
    <div>
      <div class="page-header">
        <div>
          <h1>New project</h1>
          <div class="page-sub">You can change any of this later in the project settings.</div>
        </div>
      </div>
      <div class="card">
        <ProjectForm
          initial={initial}
          submitLabel="Create project"
          onSaved={(project) => navigate(`/project/${project.id}/editor`)}
          onCancel={() => navigate('/')}
        />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div class="card empty-state">
      <h3>Page not found</h3>
      <div class="row">
        <a class="btn primary" href="#/">
          Back to dashboard
        </a>
      </div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const projects = useLive(listProjects, ['projects'], []);

  useEffect(() => {
    ensureSampleOnFirstRun().then(
      () => setReady(true),
      (error: unknown) => {
        setStartupError(errorMessage(error));
        setReady(true);
      },
    );
  }, []);

  const [section, a, b] = route.path;
  const current = section ?? '';
  const activeProjects = (projects ?? []).filter((p) => p.status === 'active').slice(0, 8);

  let page;
  if (!ready) page = <div class="card muted">Loading…</div>;
  else if (current === '') page = <Dashboard />;
  else if (current === 'projects' && a === 'new') page = <NewProject />;
  else if (current === 'project' && a) page = <ProjectView key={a} id={a} tab={b ?? ''} query={route.query} />;
  else if (current === 'tm') page = <TMView />;
  else if (current === 'settings') page = <Settings />;
  else page = <NotFound />;

  return (
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/">
          <span class="brand-mark" lang="fa">
            ف
          </span>
          <span>
            <span class="brand-name">Farsi Desk</span>
            <br />
            <span class="brand-sub" lang="fa" dir="rtl">
              میز کار مترجم
            </span>
          </span>
        </a>
        <nav class="nav" aria-label="Main">
          <a href="#/" class={current === '' ? 'active' : ''}>
            Dashboard
          </a>
          <a href="#/tm" class={current === 'tm' ? 'active' : ''}>
            Translation memory
          </a>
          <a href="#/settings" class={current === 'settings' ? 'active' : ''}>
            Settings &amp; backup
          </a>
          {activeProjects.length > 0 && <div class="nav-label">Active projects</div>}
          {activeProjects.map((project) => (
            <a
              key={project.id}
              href={`#/project/${project.id}/editor`}
              class={`nav-project ${current === 'project' && a === project.id ? 'active' : ''}`}
              dir="auto"
              title={project.name}
            >
              {project.name}
            </a>
          ))}
        </nav>
        <div class="sidebar-foot">All data stays in this browser.</div>
      </aside>
      <main class="main">
        {startupError && (
          <div class="notice err" style={{ marginBottom: '16px' }}>
            Farsi Desk could not open its local database ({startupError}). Private/incognito windows and blocked
            site data can cause this.
          </div>
        )}
        {page}
      </main>
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}
