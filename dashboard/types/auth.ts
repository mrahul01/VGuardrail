/** Role definitions matching Cognito groups. */
export type Role = "super_admin" | "org_admin" | "auditor" | "viewer";

/** Authenticated user session. */
export interface UserSession {
  id: string;
  email: string;
  role: Role;
  orgId: string;
  orgName: string;
  groups: string[];
}

/** JWT payload claims from Cognito. */
export interface CognitoJwtClaims {
  sub: string;
  email: string;
  "cognito:groups": string[];
  "custom:org_id": string;
  "custom:org_name"?: string;
  "custom:role"?: string;
  exp: number;
  iat: number;
}

/** Login request. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Login response. */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    role: Role;
    org_id: string;
  };
}
