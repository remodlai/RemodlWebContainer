/**
 * Type declarations for ?raw imports (Vite/tsup feature)
 * Allows importing files as raw strings
 */

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.js?raw' {
  const content: string;
  export default content;
}

declare module '*.cjs?raw' {
  const content: string;
  export default content;
}
