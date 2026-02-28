import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './hooks/useTooltipLevel.jsx';
import App from './App.jsx';
import './App.css';
import './settings.css';
import './depth-effects.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>
);
