import React from 'react';
import { useApp } from './context/AppContext';
import { AppShell } from './components/shell/AppShell';
import { HomeRoute } from './routes/HomeRoute';
import { ProjectsRoute } from './routes/ProjectsRoute';
import { StudioRoute } from './routes/StudioRoute';
import { AIBriefsRoute } from './routes/AIBriefsRoute';
import { ReviewRoute } from './routes/ReviewRoute';
import { VersionsRoute } from './routes/VersionsRoute';
import { DeliverRoute } from './routes/DeliverRoute';
import { SettingsRoute } from './routes/SettingsRoute';

export const App: React.FC = () => {
  const { currentRoute } = useApp();

  const renderRoute = () => {
    switch (currentRoute) {
      case 'home':
        return <HomeRoute />;
      case 'projects':
        return <ProjectsRoute />;
      case 'studio':
        return <StudioRoute />;
      case 'ai-briefs':
        return <AIBriefsRoute />;
      case 'review':
        return <ReviewRoute />;
      case 'versions':
        return <VersionsRoute />;
      case 'deliver':
        return <DeliverRoute />;
      case 'settings':
        return <SettingsRoute />;
      default:
        return <HomeRoute />;
    }
  };

  return <AppShell>{renderRoute()}</AppShell>;
};
