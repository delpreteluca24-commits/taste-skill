import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/playfair-display/latin-400.css'
import '@fontsource/playfair-display/latin-400-italic.css'
import '@fontsource/manrope/latin-300.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import './index.css'
import { Presentation } from './components/Presentation'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Presentation />
  </React.StrictMode>,
)
