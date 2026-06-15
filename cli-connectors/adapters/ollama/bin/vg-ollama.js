#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for Ollama
 *
 * This script is the entry point for the vg-ollama command.
 * It loads and runs the Ollama adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
