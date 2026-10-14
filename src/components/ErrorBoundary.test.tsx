import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../lib/telemetry', () => ({
  captureError: vi.fn(),
}));

import { captureError } from '../lib/telemetry';

let shouldThrow = false;

/** Stands in for any dashboard page that throws while rendering. */
function Page({ label = 'page content' }: { label?: string }) {
  if (shouldThrow) throw new Error('kaboom while rendering');
  return <p>{label}</p>;
}

beforeEach(() => {
  shouldThrow = false;
  vi.clearAllMocks();
  // React re-logs anything a boundary catches; keep the console readable and
  // assert on our own reporting instead.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('replaces a throwing subtree with a recoverable message', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary scope="dashboard:reports">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This screen hit a problem')).toBeInTheDocument();
    expect(screen.getByText(/kaboom while rendering/)).toBeInTheDocument();
  });

  it('reports the failure with the scope it was given', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary scope="dashboard:patients">
        <Page />
      </ErrorBoundary>,
    );
    expect(captureError).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(captureError).mock.calls[0];
    expect((error as Error).message).toBe('kaboom while rendering');
    expect(context).toMatchObject({ scope: 'dashboard:patients' });
  });

  it('recovers when the underlying problem goes away', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This screen hit a problem')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('uses a caller-provided fallback when one is supplied', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary fallback={error => <span>custom: {error.message}</span>}>
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom: kaboom while rendering')).toBeInTheDocument();
    expect(screen.queryByText('This screen hit a problem')).not.toBeInTheDocument();
  });

  it('keeps a reload affordance available for stuck states', () => {
    shouldThrow = true;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload, origin: 'http://localhost' },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
  });
});
