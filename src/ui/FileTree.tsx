import { FileTextIcon } from '@radix-ui/react-icons';
import type { FileChange } from '../shared/protocol';

interface Props {
  files: FileChange[];
  prefix?: string;
  selected: string;
  staged: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onStage: (path: string) => void;
  onOpen?: (path: string) => void;
}

export function FileTree(props: Props) {
  const prefix = props.prefix ?? '';
  const directories = [...new Set(props.files.flatMap(file => {
    const relative = file.path.slice(prefix.length);
    return relative.includes('/') ? [relative.slice(0, relative.indexOf('/'))] : [];
  }))].sort();
  const files = props.files.filter(file => !file.path.slice(prefix.length).includes('/')).sort((a, b) => a.path.localeCompare(b.path));
  return <>
    {directories.map(directory => <details className="file-directory" open key={directory}>
      <summary><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h4l1.5 2H14v7H2V4Z" stroke="currentColor" strokeLinejoin="round"/></svg><span>{directory}</span></summary>
      <FileTree {...props} prefix={`${prefix}${directory}/`} files={props.files.filter(file => file.path.startsWith(`${prefix}${directory}/`))}/>
    </details>)}
    {files.map(item => {
      const status = item.conflict ? '!' : item.index === '?' ? 'U' : props.staged ? item.index : item.worktree;
      return <div key={item.path} className={`file-entry ${props.selected === item.path ? 'selected' : ''}`}>
        <button className="file-row" onClick={() => props.onSelect(item.path)} onDoubleClick={props.onOpen ? () => props.onOpen!(item.path) : undefined} aria-pressed={props.selected === item.path}>
          <FileTextIcon/><span title={item.oldPath ? `${item.oldPath} → ${item.path}` : item.path}>{item.path.slice(prefix.length)}</span><b className={`file-status status-${status}`}>{status}</b>
        </button>
        <button className="file-stage" disabled={props.busy} title={props.staged ? '取消暂存' : '暂存'} aria-label={`${props.staged ? '取消暂存' : '暂存'} ${item.path}`} onClick={() => props.onStage(item.path)}>{props.staged ? '−' : '+'}</button>
      </div>;
    })}
  </>;
}
