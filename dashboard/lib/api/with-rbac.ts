// Higher-order route handler factory that wires the standard BFF pipeline:
//
//   1. Resolve the caller's session
//   2. Apply the org-scoped repository wrapper
//   3. Run any required RBAC action checks
//   4. Hand the typed BFF context + repos to the inner handler
//   5. Translate thrown BffAuthError to a 4xx response
//
// Routes that just need read access can use `withRead(handler)`. Routes
// that need a specific action can use `withAction("deactivate:device", handler)`.
// Routes that need full control can use `withBff(handler)`.

import { NextRequest, NextResponse } from "next/server";
import { apiErrorFromUnknown } from "@/lib/api/response";
import { extractRequestContext, type RequestContext } from "@/lib/api/request-context";
import { authorizeRoute } from "@/lib/auth/rbac-middleware";
import {
  createScopedRepositories,
  type ScopedRepositories,
} from "@/lib/api/scoped-repository";
import { createRepositoryRegistry } from "@/lib/api/registry";
import { getStoredSession } from "@/lib/auth/session-store";
import {
  isLocalAuthDisabled,
  MOCK_ID_TOKEN,
} from "@/lib/auth/local-mode";

export interface BffRequestContext {
  readonly req: NextRequest;
  readonly params: Record<string, string>;
  readonly repos: ScopedRepositories;
  readonly context: RequestContext;
}

export type BffHandler = (ctx: BffRequestContext) => Promise<NextResponse>;

export interface BffRouteOptions {
  readonly action?: string;
  readonly requireAuth?: boolean;
}

export function withBff(
  options: BffRouteOptions,
  handler: BffHandler
): (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<NextResponse> {
  return async (req, routeCtx) => {
    try {
      const ctx = await extractRequestContext(req);
      authorizeRoute(ctx, req.method, req.nextUrl.pathname);
      // In local-dev mode, use the mock ID token (the backend ignores it
      // when VG_DEV_CLAIMS is set).  In production, forward the real
      // Cognito ID token so the backend can verify `custom:org_id`.
      const token = isLocalAuthDisabled()
        ? MOCK_ID_TOKEN
        : (await getStoredSession())?.idToken;
      const registry = createRepositoryRegistry({ token });
      const scoped = createScopedRepositories(registry, ctx.session);
      return await handler({
        req,
        params: routeCtx?.params ?? {},
        repos: scoped,
        context: ctx,
      });
    } catch (e) {
      return apiErrorFromUnknown(e);
    }
  };
}

export function withRead(handler: BffHandler) {
  return withBff({}, handler);
}

export function withAction(action: string, handler: BffHandler) {
  return withBff({ action }, handler);
}
