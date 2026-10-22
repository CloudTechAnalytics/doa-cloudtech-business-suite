import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers/AppProviders'
import { Splash } from '@/app/layouts/Splash'
import { AppRoutes } from '@/app/router/router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <Splash />
      <AppRoutes />
    </AppProviders>
  </StrictMode>,
)
