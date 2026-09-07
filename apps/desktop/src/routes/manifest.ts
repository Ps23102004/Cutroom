import React from 'react';
import {
  HomeIcon,
  ProjectsIcon,
  StudioIcon,
  AIBriefsIcon,
  ReviewIcon,
  VersionsIcon,
  DeliverIcon,
  SettingsIcon,
  JobsIcon,
  HelpIcon,
  type IconProps,
} from '@cutroom/ui';

export type RouteId =
  | 'home'
  | 'projects'
  | 'studio'
  | 'ai-briefs'
  | 'review'
  | 'versions'
  | 'deliver'
  | 'settings';

export type UtilityId = 'jobs' | 'help';

export interface RouteDefinition {
  id: RouteId;
  label: string;
  path: string;
  icon: React.FC<IconProps>;
  requiresProject?: boolean;
  description: string;
}

export interface UtilityDefinition {
  id: UtilityId;
  label: string;
  icon: React.FC<IconProps>;
  description: string;
}

/**
 * Single immutable route manifest.
 * Exactly eight primary routes + two footer utilities.
 * Order is strictly enforced.
 */
export const PRIMARY_ROUTES: readonly RouteDefinition[] = [
  {
    id: 'home',
    label: 'Home',
    path: '/home',
    icon: HomeIcon,
    requiresProject: false,
    description: 'Workspace overview, resume card, recent projects, attention items',
  },
  {
    id: 'projects',
    label: 'Projects',
    path: '/projects',
    icon: ProjectsIcon,
    requiresProject: false,
    description: 'Project directory, brief, media assets, asset detail',
  },
  {
    id: 'studio',
    label: 'Studio',
    path: '/studio',
    icon: StudioIcon,
    requiresProject: true,
    description: 'Synchronized editor: preview, timeline, transcript, focused inspectors',
  },
  {
    id: 'ai-briefs',
    label: 'AI Briefs',
    path: '/ai-briefs',
    icon: AIBriefsIcon,
    requiresProject: true,
    description: 'Intent, bounded plan, source selections, recipe runs',
  },
  {
    id: 'review',
    label: 'Review',
    path: '/review',
    icon: ReviewIcon,
    requiresProject: true,
    description: 'Package management, client comments, change proposals, approvals',
  },
  {
    id: 'versions',
    label: 'Versions',
    path: '/versions',
    icon: VersionsIcon,
    requiresProject: true,
    description: 'Immutable revision history, visual comparison diffs, restore',
  },
  {
    id: 'deliver',
    label: 'Deliver',
    path: '/deliver',
    icon: DeliverIcon,
    requiresProject: true,
    description: 'Output preset setup, preflight checks, render queue, packages',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: SettingsIcon,
    requiresProject: false,
    description: 'App preferences, storage, models, media engine, privacy, diagnostics',
  },
] as const;

export const FOOTER_UTILITIES: readonly UtilityDefinition[] = [
  {
    id: 'jobs',
    label: 'Jobs',
    icon: JobsIcon,
    description: 'Truthful background task queue & process monitor',
  },
  {
    id: 'help',
    label: 'Help & Support',
    icon: HelpIcon,
    description: 'Searchable documentation, diagnostics, local support assistant',
  },
] as const;
