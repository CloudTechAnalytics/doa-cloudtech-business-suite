import { defineIndustry } from '@/core/industry-registry/define'
import { demoWidget } from '@/shared/components/widgets'
import { retailConfig } from './config'
import { retailDemo } from './demo'
import { retailSetupQuestions } from './setup'

export const retail = defineIndustry({
  ...retailConfig,
  modules: [],
  permissions: [],
  navigation: [],
  routes: [],
  onboarding: { questions: retailSetupQuestions },
  dashboardWidgets: [{ id: 'retail-kpis', title: 'Trading overview', component: demoWidget(retailDemo) }],
  workflows: [],
})
