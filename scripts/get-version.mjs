#!/usr/bin/env node
// scripts/get-version.js
import { computeVersion } from './version-utils.mjs';

const args = process.argv.slice(2);
const dev = args.includes('--dev');

console.log(computeVersion({ dev }));