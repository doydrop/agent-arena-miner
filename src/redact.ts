/** Remove secrets from anything that might be printed. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, "Bearer [redacted]");
}

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export function createLogger(secrets: readonly string[]): Logger {
  const write = (fn: (line: string) => void) => (message: string) => fn(redactSecrets(message, secrets));
  return {
    info: write((line) => console.log(line)),
    error: write((line) => console.error(line)),
  };
}
