/** Startup failed after its exact guest was reaped and private run directory removed. */
export class DesktopStartupError extends Error {
  constructor() {
    super('The private desktop did not start within its restrictions.');
    this.name = 'DesktopStartupError';
  }
}
