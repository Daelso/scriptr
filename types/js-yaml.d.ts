// Minimal ambient declaration for js-yaml (transitive dep, no @types package
// installed). Provides just enough typing for the fuses test.
declare module "js-yaml" {
  export function load(input: string): unknown;
}
