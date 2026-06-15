#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for Claude Code
 *
 * This script is the entry point for the vg-claude command.
 * It loads and runs the Claude Code adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });