import { createRoot } from 'react-dom/client'
import App from './App'
import DetachedTerminal from './components/DetachedTerminal'
import './styles.css'

// Deliberately no StrictMode: it double-invokes effects in dev, which would
// spawn a second pty and a second xterm instance for every pane.
const detachedId = new URLSearchParams(window.location.search).get('popout')
createRoot(document.getElementById('root')!).render(detachedId ? <DetachedTerminal id={detachedId} /> : <App />)
