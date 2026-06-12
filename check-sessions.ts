import { SessionManager } from '@earendil-works/pi-coding-agent';
import { join } from 'path';
import { homedir } from 'os';

async function main() {
  const dir = join(homedir(), '.pi-kot/sessions/da2edc72-566c-4860-9f62-91a8603b99d3');
  console.log('dir:', dir);

  // Try with the project's actual workspace path
  const ws = '/home/hakeem/WORKING/pi-kot/WORKING/openkot';
  try {
    const r = await SessionManager.list(ws, dir);
    console.log('With project ws:', JSON.stringify(r, null, 2));
  } catch(e: any) {
    console.log('Error with project ws:', e.message);
  }

  // Try with the default workspace path
  const ws2 = '/home/hakeem/WORKING/pi-kot/WORKING';
  try {
    const r2 = await SessionManager.list(ws2, dir);
    console.log('With default ws:', JSON.stringify(r2, null, 2));
  } catch(e: any) {
    console.log('Error with default ws:', e.message);
  }
}

main().catch(console.error);
