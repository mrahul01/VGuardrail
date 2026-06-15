#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for Shell-GPT (sgpt)
 *
 * This script is the entry point for the vg-sgpt command.
 * It loads and runs the Shell-GPT adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
