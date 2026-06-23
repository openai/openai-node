import { Writable } from 'stream';
import type ts from 'typescript';

type Formatter = (input: string) => string;

export interface Reporter {
  formatDiagnosticsHost: ts.FormatDiagnosticsHost;
  reportDiagnostic: ts.DiagnosticReporter;
  reportSolutionBuilderStatus: ts.DiagnosticReporter;
  reportErrorSummary: ts.ReportEmitErrorSummary;
  reportWatchStatus: ts.WatchStatusReporter;
}

export interface ReporterOptions {
  cwd: string;
  system: ts.System;
  formatDiagnostics: (typeof ts)['formatDiagnostics'];
  output: Writable;
  prefix?: string;
}

export function createReporter({
  cwd,
  system,
  formatDiagnostics,
  output,
  prefix = '',
}: ReporterOptions): Reporter {
  const formatDiagnosticsHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => cwd,
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => system.newLine,
  };

  function writeString(content: string) {
    output.write(prefix + content);
  }

  function reportDiagnostic(diagnostic: ts.Diagnostic): void {
    const formatted = formatDiagnostics([diagnostic], formatDiagnosticsHost);
    writeString(formatted);
  }

  function reportErrorSummary(errorCount: number): void {
    writeString(`Found ${errorCount} ${errorCount === 1 ? 'error' : 'errors'}.\n`);
  }

  function reportWatchStatus(diagnostic: ts.Diagnostic, newLine: string) {
    const formatted = formatDiagnostics([diagnostic], {
      ...formatDiagnosticsHost,
      getNewLine: () => newLine,
    });

    writeString(formatted);
  }

  return {
    formatDiagnosticsHost,
    reportDiagnostic,
    reportSolutionBuilderStatus: reportDiagnostic,
    reportErrorSummary,
    reportWatchStatus,
  };
}

export function getReportStyles(): Formatter[] {
  const passthrough = (input: string) => input;
  return [passthrough];
}
