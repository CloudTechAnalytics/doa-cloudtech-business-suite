import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers/AppProviders'
import { SetupMissing } from '@/app/layouts/SetupMissing'
import { InstallPrompt, OfflineBar } from '@/app/layouts/InstallPrompt'
import { Splash } from '@/app/layouts/Splash'
import { isMisconfigured } from '@/shared/utilities/env'
import { registerServiceWorker } from '@/shared/utilities/registerServiceWorker'
import { installChunkReload } from '@/shared/utilities/chunkReload'
import { AppRoutes } from '@/app/router/router'
import './index.css'

registerServiceWorker()
installChunkReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMisconfigured ? <SetupMissing /> : (
      <AppProviders>
        <Splash />
        <OfflineBar />
        <AppRoutes />
        <InstallPrompt />
      </AppProviders>
    )}
  </StrictMode>,
)
