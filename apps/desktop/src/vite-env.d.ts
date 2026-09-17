/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to 'true' at build time to produce a QA build with fixture mode enabled. */
  readonly VITE_QA_FIXTURES?: string;
}

declare module '*.glb' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}
