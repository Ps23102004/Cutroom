import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Badge, Modal, Input, Select } from '@cutroom/ui';
import { PlusIcon, FolderIcon, UploadIcon, PlayIcon, AlertCircleIcon } from '@cutroom/ui';
import { Cutline } from '../components/cutline/Cutline';

export const HomeRoute: React.FC = () => {
  const {
    projects,
    activeProject,
    openProject,
    navigate,
    createProject,
    enableFixtureMode,
    isFixtureMode,
    jobs,
    isNativeConnected,
  } = useApp();

  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAspectRatio, setNewProjectAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [newProjectFps, setNewProjectFps] = useState('24');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const failedJobs = jobs.filter((j) => j.status === 'failed');

  const handleOpenProject = async (projectId: string) => {
    try {
      await openProject(projectId);
      navigate('studio');
    } catch (err) {
      console.error('Failed to open project:', err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await createProject({
        name: newProjectName.trim(),
        aspectRatio: newProjectAspectRatio,
        fpsNumerator: parseInt(newProjectFps, 10),
        fpsDenominator: 1,
      });
      setIsNewProjectModalOpen(false);
      setNewProjectName('');
      navigate('studio');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(`Project creation failed: ${msg}`);
      console.error('Failed to create project:', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Workspace Header & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <Cutline size={72} />
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--text-primary, #FAF8FF)' }}>
              Workspace Overview
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
              Your projects, recent work, and tasks needing attention.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Button
            variant="primary"
            leftIcon={<PlusIcon size={16} />}
            onClick={() => {
              setCreateError(null);
              setIsNewProjectModalOpen(true);
            }}
          >
            New Project
          </Button>
          <Button
            variant="secondary"
            leftIcon={<FolderIcon size={16} />}
            onClick={() => navigate('projects')}
          >
            Browse Projects
          </Button>
          <Button
            variant="outline"
            leftIcon={<UploadIcon size={16} />}
            onClick={() => navigate('projects')}
          >
            Import Media
          </Button>
        </div>
      </div>

      {/* Attention / Alert Items (failed jobs or attention required) */}
      {failedJobs.length > 0 && (
        <div
          style={{
            backgroundColor: 'rgba(224, 108, 117, 0.12)',
            border: '1px solid var(--destructive, #E06C75)',
            borderRadius: '10px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertCircleIcon size={18} style={{ color: 'var(--destructive, #E06C75)' }} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--destructive, #E06C75)' }}>
                {failedJobs.length} Background Task{failedJobs.length > 1 ? 's' : ''} Failed
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
                {failedJobs[0]?.title}: {failedJobs[0]?.error || 'Process failed during execution.'}
              </div>
            </div>
          </div>
          <Button size="sm" variant="destructive" onClick={() => navigate('projects')}>
            Review Tasks
          </Button>
        </div>
      )}

      {/* Active Resume Card (if project open) */}
      {activeProject && (
        <Card
          raised
          padding="lg"
          style={{
            borderColor: 'var(--border-strong, #3D3D55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent-violet, #C4B5FD)', letterSpacing: '0.06em' }}>
                Active Project
              </span>
              <Badge variant={activeProject.status}>{activeProject.status.toUpperCase()}</Badge>
              {activeProject.isFixture && <Badge variant="fixture">Fixture</Badge>}
            </div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
              {activeProject.name}
            </h2>
            <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
              <span>Location: {activeProject.path}</span>
              <span>Format: {activeProject.aspectRatio} @ {activeProject.fpsNumerator}fps</span>
              <span>Revisions: {activeProject.revisionCount}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              variant="primary"
              leftIcon={<PlayIcon size={16} />}
              onClick={() => void handleOpenProject(activeProject.id)}
            >
              Resume in Studio
            </Button>
          </div>
        </Card>
      )}

      {/* Recent Projects Section */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
            Recent Projects
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary, #8E87A0)' }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''} found
          </span>
        </div>

        {projects.length === 0 ? (
          /* First-run / Empty State */
          <Card
            padding="lg"
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              borderStyle: 'dashed',
            }}
          >
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
              No projects created yet
            </h4>
            <p style={{ margin: '8px auto 20px', maxWidth: '440px', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)', lineHeight: 1.5 }}>
              Cutroom starts with a clean, empty workspace. Create your first project to begin importing audio/video recordings and generating speech transcripts.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <Button variant="primary" leftIcon={<PlusIcon size={16} />} onClick={() => setIsNewProjectModalOpen(true)}>
                Create First Project
              </Button>
              {import.meta.env.DEV && !isFixtureMode && (
                <Button variant="outline" onClick={enableFixtureMode}>
                  Explore with Sample Fixtures [FIXTURE]
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {projects.map((proj) => (
              <button
                key={proj.id}
                type="button"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  backgroundColor: 'var(--bg-panel, #0F0F16)',
                  border: '1px solid var(--border-default, #2A2A3A)',
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: 'pointer',
                  color: 'inherit',
                  transition: 'border-color 150ms ease',
                }}
                onClick={() => void handleOpenProject(proj.id)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
                    {proj.name}
                  </h4>
                  <Badge variant={proj.status}>{proj.status}</Badge>
                </div>
                <div style={{ margin: '8px 0', fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
                  {proj.path}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: 'var(--text-tertiary, #8E87A0)',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--border-subtle, #1E1E2A)',
                  }}
                >
                  <span>{proj.aspectRatio} • {proj.fpsNumerator} fps</span>
                  <span>{proj.revisionCount} revisions</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* System Health Card */}
      <Card padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #C2BCCC)' }}>
              LOCAL SYSTEM STATUS
            </span>
            <div style={{ fontSize: '13px', color: 'var(--text-primary, #FAF8FF)', marginTop: '2px' }}>
              {isNativeConnected ? 'Desktop engine connected.' : 'Browser preview — desktop engine unavailable.'}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigate('settings')}>
            View System Settings
          </Button>
        </div>
      </Card>

      {/* New Project Modal */}
      <Modal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        title="Create New Project"
        description="Initialize a project workspace with timeline settings; the desktop native picker chooses its storage directory."
      >
        <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {createError && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'rgba(224, 108, 117, 0.12)',
                border: '1px solid var(--destructive, #E06C75)',
                borderRadius: '6px',
                color: 'var(--destructive, #E06C75)',
                fontSize: '13px',
              }}
            >
              {createError}
            </div>
          )}
          <Input
            label="Project Name"
            placeholder="e.g. Episode 12 - Deep Dive Interview"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            required
            autoFocus
          />
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
            The desktop native folder picker will choose and authorize the project storage directory. Browser preview reports native-unavailable.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Select
              label="Aspect Ratio"
              value={newProjectAspectRatio}
              onChange={(e) => setNewProjectAspectRatio(e.target.value as '16:9' | '9:16' | '1:1')}
              options={[
                { value: '16:9', label: '16:9 Landscape (4K UHD / 1080p)' },
                { value: '9:16', label: '9:16 Vertical (4K Reel / Shorts)' },
                { value: '1:1', label: '1:1 Square (Social Master)' },
              ]}
            />
            <Select
              label="Timebase (FPS)"
              value={newProjectFps}
              onChange={(e) => setNewProjectFps(e.target.value)}
              options={[
                { value: '24', label: '24.00 fps (Cinema/Standard)' },
                { value: '30', label: '30.00 fps (Video)' },
                { value: '60', label: '60.00 fps (High Motion)' },
              ]}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsNewProjectModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isCreating} disabled={!newProjectName.trim()}>
              Create Project
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
