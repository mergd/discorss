import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Client as Styletron } from 'styletron-engine-atomic';
import { Provider as StyletronProvider } from 'styletron-react';
import { BaseProvider } from 'baseui';
import App from './App';
import { theme } from './theme';
import './index.css';

const engine = new Styletron();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <StyletronProvider value={engine}>
            <BaseProvider theme={theme}>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </BaseProvider>
        </StyletronProvider>
    </StrictMode>
);
