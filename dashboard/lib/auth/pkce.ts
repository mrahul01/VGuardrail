const PKCE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function base64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new Error("PKCE verifier length must be between 43 and 128");
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PKCE_CHARS[byte % PKCE_CHARS.length]).join("");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

export async function generatePKCE(): Promise<{
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}> {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: await generateCodeChallenge(codeVerifier),
  };
}

export function generateOAuthState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
