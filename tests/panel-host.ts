// Development test host only. The shipped plugin embeds panel.html via MCP.
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
const status = document.getElementById('host-status')!;
const bridge = new AppBridge(null, { name: 'Git Workbench protocol test host', version: '1' }, { serverTools: {} }, {
  hostContext: { theme: 'dark', displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'], platform: 'desktop' },
});
bridge.oncalltool = async params => {
  const response = await fetch('/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
bridge.oninitialized = async () => {
  status.textContent = 'SDK bridge connected · test repository only';
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await (await fetch('/initial')).json());
};
document.getElementById('light')!.onclick = () => bridge.setHostContext({ theme: 'light' });
document.getElementById('dark')!.onclick = () => bridge.setHostContext({ theme: 'dark' });
document.getElementById('narrow')!.onclick = () => { frame.style.width = '440px'; };
document.getElementById('wide')!.onclick = () => { frame.style.width = '100%'; };
await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
frame.src = '/panel';
