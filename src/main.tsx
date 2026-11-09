import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { scheduleSync, startAutoSync } from './drive'
import { initStore, onLocalChange } from './store'
import './index.css'

onLocalChange(scheduleSync)
initStore().then(startAutoSync)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
