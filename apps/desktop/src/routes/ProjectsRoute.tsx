import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Input, Select, Badge, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Modal } from '@cutroom/ui';
import { PlusIcon, UploadIcon, SearchIcon, FolderIcon } from '@cutroom/ui';
import { Asset } from '../lib/contracts';
import { SourceViewer } from '../components/media/SourceViewer';

type ProjectsSubview = 'directory' | 'overview' | 'media' | 'asset_detail';

export const ProjectsRoute: React.FC = () => {
  const {
    projects,
    activeProject,
    openProject,
    assets,
    importAsset,
    addClip,
    brief,
    navigate,
    createProject,
    isFixtureMode,
  } = useApp();

  const [activeSubview, setActiveSubview] = useState<ProjectsSubview>('directory');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(assets[0] || null);

  // Import Asset Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importType, setImportType] = useState<'managed' | 'linked'>('managed');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Create Project Modal state
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAspectRatio, setNewProjectAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [newProjectFps, setNewProjectFps] = useState('24');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const subviewTabs = [
    { id: 'directory', label: 'Project Directory' },
    { id: 'overview', label: 'Overview & Brief', disabled: !activeProject },
    { id: 'media', label: 'Media Management', disabled: !activeProject, count: assets.length },
    { id: 'asset_detail', label: 'Asset Detail', disabled: !selectedAsset },
  ];

  const handleImportAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsImporting(true);
    setImportError(null);
    try {
      if (isFixtureMode) {
        throw new Error('Exit fixture mode before importing media with the native file picker.');
      }
      const asset = await importAsset({
        name: importFileName.trim() || undefined,
        importType,
      });
      setSelectedAsset(asset);
      setIsImportModalOpen(false);
      setImportFileName('');
      setActiveSubview('media');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(`Asset import failed: ${msg}`);
      // Dialog remains open on failure
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddRangeFromDetail = async (inTicks: string, outTicks: string) => {
    if (!selectedAsset) return;
    await addClip({
      assetId: selectedAsset.id,
      sourceInTicks: inTicks,
      sourceOutTicks: outTicks,
    });
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
      setActiveSubview('overview');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(`Project creation failed: ${msg}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
            Projects & Media Management
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            {activeProject ? `Managing: ${activeProject.name}` : 'Select a project to inspect source media and briefs.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <Button variant="primary" leftIcon={<PlusIcon size={16} />} onClick={() => setIsNewProjectModalOpen(true)}>
            New Project
          </Button>
          {activeProject && (
            <Button
              variant="secondary"
              leftIcon={<UploadIcon size={16} />}
              onClick={() => {
                setImportError(null);
                setIsImportModalOpen(true);
              }}
              disabled={isFixtureMode}
              title={isFixtureMode ? 'Exit fixture mode before importing native media' : undefined}
            >
              Import Media
            </Button>
          )}
        </div>
      </div>

      {/* Subviews Navigation Tabs */}
      <Tabs
        items={subviewTabs}
        activeId={activeSubview}
        onChange={(id) => setActiveSubview(id as ProjectsSubview)}
      />

      {/* SUBVIEW 1: Project Directory */}
      {activeSubview === 'directory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <Input
                placeholder="Search projects by name or directory path..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<SearchIcon size={16} />}
              />
            </div>
          </div>

          {projects.length === 0 ? (
            <Card padding="lg" style={{ textAlign: 'center', borderStyle: 'dashed' }}>
              <FolderIcon size={32} style={{ color: 'var(--text-tertiary-panel, #9A91A7)', margin: '0 auto 8px' }} />
              <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary, #F3F0F6)' }}>
                No projects found
              </h3>
              <p style={{ margin: '6px 0 16px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
                Create a project to manage audio/video recordings and project briefs.
              </p>
              <Button variant="primary" onClick={() => setIsNewProjectModalOpen(true)}>
                Create New Project
              </Button>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Project Name</TableHeaderCell>
                  <TableHeaderCell>Storage Path</TableHeaderCell>
                  <TableHeaderCell>Format</TableHeaderCell>
                  <TableHeaderCell>Revisions</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects
                  .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((p) => {
                    const isCurrent = activeProject?.id === p.id;
                    return (
                      <TableRow key={p.id} style={{ backgroundColor: isCurrent ? 'var(--accent-violet-subtle, rgba(161, 138, 247, 0.08))' : undefined }}>
                        <TableCell style={{ fontWeight: 600 }}>{p.name}</TableCell>
                        <TableCell style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                          {p.path}
                        </TableCell>
                        <TableCell>{p.aspectRatio} @ {p.fpsNumerator}fps</TableCell>
                        <TableCell>{p.revisionCount}</TableCell>
                        <TableCell><Badge variant={p.status}>{p.status}</Badge></TableCell>
                        <TableCell>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <Button
                              size="sm"
                              variant={isCurrent ? 'secondary' : 'primary'}
                              onClick={() => {
                                void openProject(p.id)
                                  .then(() => setActiveSubview('overview'))
                                  .catch((err) => console.error('Failed to open project:', err));
                              }}
                            >
                              {isCurrent ? 'Manage' : 'Open'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                void openProject(p.id)
                                  .then(() => navigate('studio'))
                                  .catch((err) => console.error('Failed to open project:', err));
                              }}
                            >
                              Studio
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* SUBVIEW 2: Project Overview & Brief */}
      {activeSubview === 'overview' && activeProject && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
            <Card padding="md">
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                Deliverable Constraints & Brief
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Target Master:</span>
                  <span style={{ fontWeight: 500 }}>1080p SDR Apple Silicon</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Aspect Ratio:</span>
                  <span style={{ fontWeight: 500 }}>{activeProject.aspectRatio}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Frame Rate:</span>
                  <span style={{ fontWeight: 500 }}>{activeProject.fpsNumerator}/{activeProject.fpsDenominator} fps</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Editorial Goal:</span>
                  <span style={{ fontWeight: 500 }}>{brief?.goal || 'Not specified'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Target Duration:</span>
                  <span style={{ fontWeight: 500 }}>{brief?.targetDurationSeconds ? `${brief.targetDurationSeconds}s` : '60s'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Audience:</span>
                  <span style={{ fontWeight: 500 }}>{brief?.audience || 'General'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Source Media Health:</span>
                  <span style={{ color: 'var(--text-secondary, #BAB3C5)', fontWeight: 500 }}>Unavailable until native verification</span>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <Button size="sm" variant="secondary" onClick={() => navigate('ai-briefs')}>
                    Edit AI Brief & Constraints
                  </Button>
                </div>
              </div>
            </Card>

            <Card padding="md">
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                Revision Snapshot
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                <div>Total Revisions: <strong>{activeProject.revisionCount}</strong></div>
                <div>Status: <Badge variant={activeProject.status}>{activeProject.status}</Badge></div>
                <div style={{ marginTop: '10px' }}>
                  <Button size="sm" variant="secondary" onClick={() => navigate('versions')}>
                    View Revisions
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* SUBVIEW 3: Media Management */}
      {activeSubview === 'media' && activeProject && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
              Source files imported into project ({assets.length} assets)
            </span>
            <Button
              size="sm"
              variant="primary"
              leftIcon={<UploadIcon size={14} />}
              onClick={() => setIsImportModalOpen(true)}
              disabled={isFixtureMode}
              title={isFixtureMode ? 'Exit fixture mode before importing native media' : undefined}
            >
              Import Audio/Video
            </Button>
          </div>

          {assets.length === 0 ? (
            <Card padding="lg" style={{ textAlign: 'center', borderStyle: 'dashed' }}>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
                No media assets imported yet
              </p>
              <p style={{ margin: '6px 0 14px', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                Import camera recordings, screencasts, or audio files to generate transcripts and edit.
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setIsImportModalOpen(true)}
                disabled={isFixtureMode}
                title={isFixtureMode ? 'Exit fixture mode before importing native media' : undefined}
              >
                Import Source Media
              </Button>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Asset Name</TableHeaderCell>
                  <TableHeaderCell>Format / Codec</TableHeaderCell>
                  <TableHeaderCell>Resolution</TableHeaderCell>
                  <TableHeaderCell>Import Mode</TableHeaderCell>
                  <TableHeaderCell>Proxy Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell style={{ fontWeight: 600 }}>{asset.name}</TableCell>
                    <TableCell>{asset.codec} ({asset.format})</TableCell>
                    <TableCell>{asset.width} × {asset.height}</TableCell>
                    <TableCell>
                      <Badge variant={asset.importType === 'managed' ? 'violet' : 'neutral'}>
                        {asset.importType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={asset.proxyStatus === 'ready' ? 'approved' : 'neutral'}>
                        {asset.proxyStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedAsset(asset);
                          setActiveSubview('asset_detail');
                        }}
                      >
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* SUBVIEW 4: Asset Detail (Astra Review Correction 2: No fixed peak claims) */}
      {activeSubview === 'asset_detail' && selectedAsset && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SourceViewer
            asset={selectedAsset}
            onAddRange={handleAddRangeFromDetail}
            aspectRatio={activeProject?.aspectRatio || '16:9'}
          />

          <Card padding="lg">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                {selectedAsset.name}
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                Path: {selectedAsset.path}
              </span>
            </div>
            <Badge variant={selectedAsset.importType === 'managed' ? 'violet' : 'neutral'}>
              {selectedAsset.importType.toUpperCase()}
            </Badge>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <Card padding="sm" raised>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>CODEC</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>{selectedAsset.codec}</div>
            </Card>
            <Card padding="sm" raised>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>RESOLUTION</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>{selectedAsset.width} × {selectedAsset.height}</div>
            </Card>
            <Card padding="sm" raised>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>TIMEBASE</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                {selectedAsset.timeBase.num}/{selectedAsset.timeBase.den} s/tick · {selectedAsset.fpsNumerator}/{selectedAsset.fpsDenominator} fps
              </div>
            </Card>
            <Card padding="sm" raised>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>AUDIO CHANNELS</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>{selectedAsset.audioChannels} channels</div>
            </Card>
          </div>

          {/* Waveform representation: truthful pending state */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #BAB3C5)', marginBottom: '6px' }}>
              AUDIO WAVEFORM PROFILE
            </div>
            <div
              style={{
                width: '100%',
                height: '54px',
                backgroundColor: 'var(--bg-app, #19161F)',
                borderRadius: '6px',
                border: '1px solid var(--border-default, #443B4F)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-tertiary-panel, #9A91A7)',
                fontSize: '12px',
              }}
            >
              Waveform profile: Pending local FFmpeg signal analysis
            </div>
          </div>

          <Button size="sm" variant="secondary" onClick={() => setActiveSubview('media')}>
            Back to Media List
          </Button>
        </Card>
      </div>
    )}

      {/* Import Media Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title="Import Media Asset"
        description="Select whether to copy into managed storage or keep a scoped linked reference."
      >
        <form onSubmit={handleImportAsset} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {importError && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(224, 108, 117, 0.15)',
                border: '1px solid var(--destructive, #E06C75)',
                borderRadius: '6px',
                color: 'var(--destructive, #E06C75)',
                fontSize: '12px',
              }}
            >
              {importError}
            </div>
          )}
          <Input
            label="File Name (optional)"
            placeholder="Taken from the native file picker when blank"
            value={importFileName}
            onChange={(e) => setImportFileName(e.target.value)}
            autoFocus
          />
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
            The desktop native file picker will choose and authorize the source. Browser preview reports native-unavailable.
          </div>
          <Select
            label="Import Storage Mode"
            value={importType}
            onChange={(e) => setImportType(e.target.value as 'managed' | 'linked')}
            options={[
              { value: 'managed', label: 'Managed Copy (Verifies SHA-256 and copies into project store)' },
              { value: 'linked', label: 'Linked Reference (Retains external reference; fast ingest)' },
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsImportModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isImporting}>
              Choose & Import Asset
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Project Modal */}
      <Modal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        title="Create New Project"
      >
        <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {createError && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(224, 108, 117, 0.15)',
                border: '1px solid var(--destructive, #E06C75)',
                borderRadius: '6px',
                color: 'var(--destructive, #E06C75)',
                fontSize: '12px',
              }}
            >
              {createError}
            </div>
          )}
          <Input
            label="Project Name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            required
            autoFocus
          />
          <Select
            label="Aspect Ratio"
            value={newProjectAspectRatio}
            onChange={(e) => setNewProjectAspectRatio(e.target.value as '16:9' | '9:16' | '1:1')}
            options={[
              { value: '16:9', label: '16:9 Landscape (YouTube, Master)' },
              { value: '9:16', label: '9:16 Vertical (Shorts, Reels, TikTok)' },
              { value: '1:1', label: '1:1 Square (Feed)' },
            ]}
          />
          <Select
            label="Base Frame Rate"
            value={newProjectFps}
            onChange={(e) => setNewProjectFps(e.target.value)}
            options={[
              { value: '24', label: '24 fps (Cinematic Standard)' },
              { value: '30', label: '30 fps (Web / Broadcast)' },
              { value: '60', label: '60 fps (High Motion)' },
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsNewProjectModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!newProjectName.trim()} isLoading={isCreating}>
              Create Project
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
