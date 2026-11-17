import type { Request } from '../shared/protocol';
export async function call<T>(request: Request): Promise<T> {
  const supplied = new URLSearchParams(location.hash.slice(1)).get('token');
  if (supplied) {
    sessionStorage.setItem('git-workbench-token', supplied);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const response = await fetch('/api/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('git-workbench-token') || ''}` },
    body: JSON.stringify(request),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data.result;
}
