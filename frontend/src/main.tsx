import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import { Calculator } from './Calculator';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Calculator /></StrictMode>);
