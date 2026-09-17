/**
 * QA-only fixture flag.
 *
 * Fixture/demo mode is enabled when running under `vite dev` OR when the
 * production build is made with `VITE_QA_FIXTURES=true`. The latter produces
 * a QA-only build used for automated click-through testing of the Studio
 * editing workflows without the Tauri desktop engine. It is never enabled
 * in real production builds.
 */
export const FIXTURES_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_QA_FIXTURES === 'true';
