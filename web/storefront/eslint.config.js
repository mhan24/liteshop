import { createConfigForNuxt } from '@nuxt/eslint-config'
import prettier from 'eslint-config-prettier'

// Node 20（服务器构建环境）没有 ES2024 的 Object.groupBy，而 eslint-flat-config-utils
// 在加载配置时依赖它；CI 用 Node 24 原生支持，这里仅作兼容垫片，保证本地/服务器可跑 lint。
if (typeof Object.groupBy !== 'function') {
  Object.groupBy = (items, keyFn) => {
    const out = {}
    for (const item of items) {
      const k = keyFn(item)
      ;(out[k] ||= []).push(item)
    }
    return out
  }
}

const nuxtConfigs = await createConfigForNuxt({
  features: {
    tooling: false,
    stylistic: false,
  },
  ignores: ['node_modules/**', '.nuxt/**', '.output/**', 'dist/**'],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
})

export default [
  ...nuxtConfigs,
  {
    rules: {
      // 项目代码大量使用 any（严格模式列入 P1 计划）
      '@typescript-eslint/no-explicit-any': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // shadcn-vue 自动生成的组件：class 等可选 prop 无需默认值
    files: ['components/ui/**/*.vue'],
    rules: {
      'vue/require-default-prop': 'off',
    },
  },
  prettier,
]
