// Standard error envelope from the v2 contract: {error:{code,message,retryable}}
export class ApiError extends Error {
  constructor({ status = 0, code = 'unknown_error', message = 'Unexpected error', retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isAbort(err) {
  return err?.name === 'AbortError' || err?.code === 'aborted';
}

export function friendlyMessage(err) {
  if (!err) return '';
  if (err.status === 503) return `${err.message} (service unavailable${err.retryable ? ', you can retry' : ''})`;
  if (err.status === 404) return `Not found: ${err.message}`;
  if (err.status === 422) return `Invalid request: ${err.message}`;
  if (err.code === 'timeout') return 'The server took too long to answer. Please retry.';
  if (err.code === 'network_error') return 'Cannot reach the MissionMatch API. Check that the backend is running.';
  return err.message || 'Unexpected error';
}
