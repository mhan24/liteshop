export const SECRET_SETTING_KEYS: string[];
export function encryptWith(authSecret: string, plain: string): string;
export function encryptPlaintextSecrets(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  authSecret: string | undefined
): Promise<string[]>;
