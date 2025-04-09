/**
 * Load a Node built-in module. ID may or may not be prefixed by `node:` and
 * will be normalized. If we used static imports then our bundle size would be bloated by
 * injected polyfills, and if we used dynamic require then in addition to bundlers logging warnings,
 * our code would not work when bundled to ESM and run in Node 18.
 * @param {string} id ID of the built-in to be loaded.
 * @returns {object|undefined} exports of the built-in. Undefined if the built-in
 * does not exist.
 */
export let getBuiltinModule: null | ((id: string) => object | undefined) = function getBuiltinModuleLazy(
  id: string,
): object | undefined {
  try {
    if (getBuiltinModule !== getBuiltinModuleLazy) return getBuiltinModule!(id);
    if ((process as any).getBuiltinModule) {
      getBuiltinModule = (process as any).getBuiltinModule;
    } else {
      /* Fallback implementation for Node 18 */
      function createFallbackGetBuiltinModule(BuiltinModule: any) {
        return function getBuiltinModule(id: string): object | undefined {
          id = BuiltinModule.normalizeRequirableId(String(id));
          if (!BuiltinModule.canBeRequiredByUsers(id)) {
            return;
          }
          const mod = BuiltinModule.map.get(id);
          mod.compileForPublicLoader();
          return mod.exports;
        };
      }
      const magicKey = Math.random() + '';
      let module: { BuiltinModule: any } | undefined;
      try {
        const kClone = Object.getOwnPropertySymbols(Blob.prototype).find(
          (e) => e.description?.includes('clone'),
        )!;
        Object.defineProperty(Object.prototype, magicKey, {
          get() {
            module = this;
            throw null;
          },
          configurable: true,
        });
        structuredClone(
          new (class extends Blob {
            [kClone]() {
              return {
                deserializeInfo: 'internal/bootstrap/realm:' + magicKey,
              };
            }
          })([]),
        );
      } catch {}
      delete (Object.prototype as any)[magicKey];
      if (module) {
        getBuiltinModule = createFallbackGetBuiltinModule(module.BuiltinModule);
      } else {
        getBuiltinModule = () => undefined;
      }
    }
    return getBuiltinModule!(id);
  } catch {
    return undefined;
  }
};
