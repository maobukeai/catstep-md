import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(pathToFileURL('./src/lib/relationships.selftest-loader.mjs'), import.meta.url);
