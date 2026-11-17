import { ensureService, workbenchUrl } from './server/connection';
import { spawn } from 'node:child_process';
void ensureService().then(connection => {
  const directory = process.argv.slice(2).find(arg => arg !== '--open');
  const url = workbenchUrl(connection, directory);
  console.log(url);
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const browser = spawn(command, [url], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.error('请在浏览器中打开上方地址。'));
    browser.unref();
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
