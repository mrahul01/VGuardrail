// ScanRequest + context models. Mirrors agent/Sources/VGCore/ScanRequest.swift.
//
// Domain types are camelCase; the wire format is snake_case with two renamed
// keys (`user_id`, and file `extension`) matching the Swift CodingKeys. Decode
// validates the wire shape with zod; encode emits the wire shape, omitting
// absent optionals.

import { z } from 'zod';
import {
  ClassificationSchema,
  RoleSchema,
  SourceSchema,
  type Classification,
  type Role,
  type Source,
} from './enums.js';
import { compact } from './schema.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/** Repository context for IDE/CLI prompts. */
export interface RepoContext {
  name: string;
  classification?: Classification;
}

/** File context for a prompt referencing a specific file. */
export interface FileContext {
  path: string;
  /** Wire key is `extension`. */
  fileExtension?: string;
}

/** The acting user and RBAC role. */
export interface UserContext {
  userId: string;
  role: Role;
  groups: string[];
}

/** Non-content metadata describing the origin of a prompt. */
export interface ScanContext {
  source?: Source;
  provider?: string;
  model?: string;
  app?: string;
  repo?: RepoContext;
  file?: FileContext;
  user: UserContext;
}

/** A prompt plus the non-content context describing where it came from. */
export interface ScanRequest {
  text: string;
  context: ScanContext;
}

// ── Wire schemas (snake_case) ────────────────────────────────────────────────

const RepoWireSchema = z
  .object({
    name: z.string(),
    classification: ClassificationSchema.optional(),
  })
  .strict();

const FileWireSchema = z
  .object({
    path: z.string(),
    extension: z.string().optional(),
  })
  .strict();

const UserWireSchema = z
  .object({
    user_id: z.string(),
    role: RoleSchema,
    groups: z.array(z.string()),
  })
  .strict();

const ContextWireSchema = z
  .object({
    source: SourceSchema.optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    app: z.string().optional(),
    repo: RepoWireSchema.optional(),
    file: FileWireSchema.optional(),
    user: UserWireSchema,
  })
  .strict();

export const ScanRequestWireSchema = z
  .object({
    text: z.string(),
    context: ContextWireSchema,
  })
  .strict();

// ── Codecs ───────────────────────────────────────────────────────────────────

/** Validates and decodes a wire ScanRequest into the domain type. */
export function decodeScanRequest(raw: unknown): ScanRequest {
  const w = ScanRequestWireSchema.parse(raw);
  const user: UserContext = {
    userId: w.context.user.user_id,
    role: w.context.user.role,
    groups: w.context.user.groups,
  };
  const context: ScanContext = { user };
  if (w.context.source !== undefined) context.source = w.context.source;
  if (w.context.provider !== undefined) context.provider = w.context.provider;
  if (w.context.model !== undefined) context.model = w.context.model;
  if (w.context.app !== undefined) context.app = w.context.app;
  if (w.context.repo !== undefined) {
    context.repo = compact({
      name: w.context.repo.name,
      classification: w.context.repo.classification,
    }) as RepoContext;
  }
  if (w.context.file !== undefined) {
    context.file = compact({
      path: w.context.file.path,
      fileExtension: w.context.file.extension,
    }) as FileContext;
  }
  return { text: w.text, context };
}

/** Encodes a domain ScanRequest to the snake_case wire object. */
export function encodeScanRequest(request: ScanRequest): unknown {
  const { context } = request;
  const wireContext = compact({
    source: context.source,
    provider: context.provider,
    model: context.model,
    app: context.app,
    repo: context.repo
      ? compact({ name: context.repo.name, classification: context.repo.classification })
      : undefined,
    file: context.file
      ? compact({ path: context.file.path, extension: context.file.fileExtension })
      : undefined,
    user: {
      user_id: context.user.userId,
      role: context.user.role,
      groups: context.user.groups,
    },
  });
  return { text: request.text, context: wireContext };
}
