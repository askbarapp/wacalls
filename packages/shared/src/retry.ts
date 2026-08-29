export function nextRetryAt(from: Date, delayMinutes: number): Date {
  return new Date(from.getTime() + delayMinutes * 60_000);
}

export function shouldRetry(params: {
  attempts: number;
  maxAttempts: number;
  doNotCall: boolean;
  outcome?: string | null;
}): boolean {
  if (params.doNotCall) return false;
  if (params.attempts >= params.maxAttempts) return false;
  if (params.outcome === "ANSWERED" || params.outcome === "INTERESTED" || params.outcome === "DO_NOT_CALL") {
    return false;
  }
  return true;
}
