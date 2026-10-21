import { defineIndustry } from '@/core/industry-registry/define'
import { demoWidget } from '@/shared/components/widgets'
import { bakeryConfig } from './config'
import { bakeryDemo } from './demo'
import { bakeryModules } from './modules'
import { bakeryNavigation } from './navigation'
import { bakeryPermissions } from './permissions'
import { bakeryRoutes } from './routes'
import { bakerySetupQuestions } from './setup'

export const bakery = defineIndustry({
  ...bakeryConfig,
  modules: bakeryModules,
  permissions: bakeryPermissions,
  navigation: bakeryNavigation,
  routes: bakeryRoutes,
  onboarding: { questions: bakerySetupQuestions },
  dashboardWidgets: [{ id: 'bakery-kpis', title: 'Bakery overview', component: demoWidget(bakeryDemo) }],
  workflows: [
    { id: 'start-production', label: 'Start production batch', module: 'bakery-production', description: 'Plan and start a production batch.' },
  ],
})
