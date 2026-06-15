#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for the GitHub Copilot CLI (gh copilot)
 *
 * This script is the entry point for the vg-gh-copilot command.
 * It loads and runs the GitHub Copilot CLI adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
