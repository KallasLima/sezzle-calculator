import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import { Calculator } from './features/calculator/Calculator';
import './styles.css';
import './features/calculator/calculator.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Calculator />
  </StrictMode>,
);
