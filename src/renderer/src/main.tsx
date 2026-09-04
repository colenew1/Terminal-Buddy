import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Deliberately no StrictMode: it double-invokes effects in dev, which would
// spawn a second pty and a second xterm instance for every pane.
createRoot(document.getElementById('root')!).render(<App />)
