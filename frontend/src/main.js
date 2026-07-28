import { createApp } from 'vue'
// LiteShop SPA bootstrap
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.config.performance = true
app.use(Antd)
app.use(router)
app.mount('#app')
