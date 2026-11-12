import { runD032Demo } from '../src/demo/d032.ts';

await runD032Demo((line) => process.stdout.write(`${line}\n`));
