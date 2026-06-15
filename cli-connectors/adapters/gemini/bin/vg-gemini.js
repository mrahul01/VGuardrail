#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for the Gemini CLI
 *
 * This script is the entry point for the vg-gemini command.
 * It loads and runs the Gemini CLI adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
