// Type the Node-only WebSocket adapter for published source navigation without @types/node.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, operation: () => R): R;
    getStore(): T | undefined;
  }
}
