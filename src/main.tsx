import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers/AppProviders'
import { SetupMissing } from '@/app/layouts/SetupMissing'
import { Splash } from '@/app/layouts/Splash'
import { isMisconfigured } from '@/shared/utilities/env'
import { AppRoutes } from '@/app/router/router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMisconfigured ? <SetupMissing /> : (
      <AppProviders>
        <Splash />
        <AppRoutes />
      </AppProviders>
    )}
  </StrictMode>,
)
