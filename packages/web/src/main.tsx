import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PhoneApp } from './phone/PhoneApp';
import { TvApp } from './tv/TvApp';
import './styles.css';

// `/tv` is the shared screen; everything else is the phone controller (`/?code=PQ7K` pre-fills the room code).
const isTv = location.pathname.replace(/\/+$/, '') === '/tv';

createRoot(document.getElementById('root')!).render(<StrictMode>{isTv ? <TvApp /> : <PhoneApp />}</StrictMode>);
