function reportApplicationError(error: unknown): void {
  const host = globalThis as typeof globalThis & { reportError?: (error: unknown) => void };
  if (typeof host.reportError === 'function') {
    host.reportError(error);
  } else {
    setTimeout(() => {
      throw error;
    }, 0);
  }
}

async function observeResult(result: unknown): Promise<void> {
  try {
    await result;
  } catch (error) {
    reportApplicationError(error);
  }
}

/** Internal callback subscriptions with optional discriminator filters; no buffering or replay. */
export class Subscriptions<Event extends { type: string }> {
  private readonly listeners = new Set<{
    listener: (event: Event) => unknown;
    type: Event['type'] | undefined;
  }>();

  /** Registers independently, including when the same function is supplied twice. */
  add(listener: (event: Event) => unknown, type?: Event['type']): () => void {
    const registration = { listener, type };
    this.listeners.add(registration);
    return () => {
      this.listeners.delete(registration);
    };
  }

  /** Delivers in registration order, isolating application exceptions from the transport. */
  emit(event: Event): void {
    const { type } = event;
    const snapshot = [...this.listeners];
    for (const registration of snapshot) {
      if (
        !this.listeners.has(registration) ||
        (registration.type !== undefined && registration.type !== type)
      ) {
        continue;
      }
      try {
        const result = registration.listener(event);
        if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
          void observeResult(result);
        }
      } catch (error) {
        reportApplicationError(error);
      }
    }
  }

  /** Releases all subscriber references. Existing unsubscribe functions remain safe. */
  clear(): void {
    this.listeners.clear();
  }
}
