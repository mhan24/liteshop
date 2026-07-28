<template>
  <div>
    <a-page-header :title="site.title || 'LiteShop'" :sub-title="site.subtitle" />
    <a-alert
      v-if="site.announcement"
      class="announce"
      type="info"
      show-icon
      :message="site.announcement"
    />
    <a-spin :spinning="loading">
        <div v-for="cat in categories" :key="cat.name || cat.default_key" class="category">
          <a-divider orientation="left">{{ catTitle(cat) }}</a-divider>
          <div class="product-grid">
            <a-card v-for="p in cat.products" :key="p.product.id" hoverable>
              <h3>{{ p.product.name }}</h3>
              <p class="muted">{{ p.product.description }}</p>
              <p class="price-text">{{ money(p.product.price_cents) }} CNY</p>
              <p class="muted">库存 {{ p.available }}</p>
              <a-button type="primary" :disabled="p.available <= 0" block @click="goProduct(p.product.id)">
                {{ p.available > 0 ? '立即购买' : '已售罄' }}
              </a-button>
            </a-card>
          </div>
        </div>
        <a-empty v-if="!loading && categories.length === 0" description="暂无上架商品" />
    </a-spin>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'

const router = useRouter()
const site = ref({})
const categories = ref([])
const loading = ref(false)

function money(cents) {
  return (cents / 100).toFixed(2)
}
function goProduct(id) {
  router.push('/product/' + id)
}
function catTitle(cat) {
  return cat.default_key === 'pinned' ? '置顶' : cat.default_key === 'default_category' ? '默认分类' : cat.name
}
async function load() {
  loading.value = true
  try {
    const [s, data] = await Promise.all([api.get('/site'), api.get('/products')])
    site.value = s
    categories.value = data.categories || []
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<style scoped>
.announce {
  margin-bottom: 16px;
}
.category {
  margin-top: 8px;
}
</style>
