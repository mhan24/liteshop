<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <h2>{{ t('products.title') }}</h2>
      <el-button type="primary" @click="$router.push('/products/new')">{{ t('products.new') }}</el-button>
    </div>
    <el-table v-loading="loading" :data="pagedProducts" size="large">
      <el-table-column prop="id" :label="t('common.id')" width="70" />
      <el-table-column label="" width="70">
        <template #default="{ row }">
          <el-image
            :src="row.image_url || DEFAULT_IMAGE"
            fit="cover"
            style="width: 48px; height: 48px; border-radius: 6px"
          >
            <template #error>.</template>
          </el-image>
        </template>
      </el-table-column>
      <el-table-column prop="name" :label="t('common.name')" />
      <el-table-column :label="t('products.category')">
        <template #default="{ row }">{{ row.category || t('products.defaultCategory') }}</template>
      </el-table-column>
      <el-table-column :label="t('products.deliveryType')" width="120">
        <template #default="{ row }">
          <el-tag :type="row.delivery_type === 'manual' ? 'warning' : 'success'" size="small">
            {{ row.delivery_type === 'manual' ? t('products.manualDelivery') : t('products.autoDelivery') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('common.price')">
        <template #default="{ row }">{{ (row.price_cents / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="available" :label="t('products.stock')" width="80" />
      <el-table-column :label="t('common.actions')" width="180">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push('/products/' + row.id + '/edit')">{{
            t('common.edit')
          }}</el-button>
          <el-tooltip
            :disabled="row.delivery_type !== 'manual'"
            :content="t('products.cardsDisabledForManual')"
            placement="top"
          >
            <el-button
              size="small"
              :disabled="row.delivery_type === 'manual'"
              @click="$router.push('/products/' + row.id + '/cards')"
            >{{ t('cards.title') }}</el-button>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
    <div style="display: flex; justify-content: flex-end; margin-top: 12px">
      <el-pagination
        v-if="products.length"
        v-model:current-page="currentPage"
        background
        layout="prev, pager, next, total"
        :total="products.length"
        :page-size="pageSize"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'

const { t } = useI18n()
const DEFAULT_IMAGE = ref('/default-product.svg')
const products = ref<any[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const pagedProducts = computed(() =>
  products.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value),
)

onMounted(async () => {
  try {
    const site = await api.get('/admin/site')
    if (site.default_product_image) DEFAULT_IMAGE.value = site.default_product_image
  } catch {
    // ignore
  }
  loading.value = true
  try {
    products.value = (await api.get('/admin/products')).products || []
  } finally {
    loading.value = false
  }
})
</script>
