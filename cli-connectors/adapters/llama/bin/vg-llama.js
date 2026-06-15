#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for the llama.cpp CLI
 *
 * This script is the entry point for the vg-llama command.
 * It loads and runs the llama.cpp adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
