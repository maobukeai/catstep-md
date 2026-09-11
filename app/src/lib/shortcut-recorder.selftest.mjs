/**
 * Self-test runner for Shortcut Recorder utilities.
 *
 * Usage (from app/): node src/lib/shortcut-recorder.selftest.mjs
 */
import { register } from 'node:module';

register(new URL('./relationships.selftest-loader.mjs', import.meta.url));

await import('./shortcut-recorder.test.ts');
