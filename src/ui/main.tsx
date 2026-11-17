import { createRoot } from 'react-dom/client';
import { App } from './App';
import { call } from './api';
import './style.css';
createRoot(document.getElementById('root')!).render(<App transport={call}/>);
