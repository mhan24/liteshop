import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '../assets/main.css'
import 'vue-sonner/style.css'
import i18n from '@/shared/i18n'
import App from './App.vue'
import router from '../router'

export function bootstrap() {
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.use(i18n)
  app.mount('#app')
}

if (typeof document !== 'undefined') {
  bootstrap()
}
