#!/usr/bin/env node
import { main } from '../src/cli.js';

main().catch((err) => {
  process.stderr.write(`急件崩了：${err?.stack || err}\n`);
  process.exit(1);
});
