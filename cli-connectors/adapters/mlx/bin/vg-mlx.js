#!/usr/bin/env node
/**
 * VGuardrail CLI wrapper for MLX LM (mlx_lm.generate)
 *
 * This script is the entry point for the vg-mlx command.
 * It loads and runs the MLX LM adapter.
 */

// Import and run the main function
import('../dist/index.js')
  .then((module) => module.main())
  .catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
