<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('products.title') }}</h2>
      <button class="btn btn-primary btn-sm" @click="$router.push('/products/new')">
        {{ t('products.new') }}
      </button>
    </div>

    <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body !p-0">
        <DataTable :columns="columns" :rows="pagedProducts" :loading="loading" :empty-text="t('audit.empty')">
          <template #image="{ row }">
            <div class="h-12 w-12">
              <ProductImage :src="row.image_url" :fallback="DEFAULT_IMAGE" />
            </div>
          </template>
          <template #category="{ row }">{{ row.category || t('products.defaultCategory') }}</template>
          <template #delivery="{ row }">
            <span class="badge badge-sm" :class="row.delivery_type === 'manual' ? 'badge-warning' : 'badge-success'">
              {{ row.delivery_type === 'manual' ? t('products.manualDelivery') : t('products.autoDelivery') }}
            </span>
          </template>
          <template #price="{ row }">{{ (row.price_cents / 100).toFixed(2) }}</template>
          <template #actions="{ row }">
            <div class="flex items-center gap-1">
              <button class="btn btn-ghost btn-xs" @click="$router.push('/products/' + row.id + '/edit')">
                {{ t('common.edit') }}
              </button>
              <button
                class="btn btn-ghost btn-xs"
                :class="{ 'btn-disabled': row.delivery_type === 'manual' }"
                :data-tip="row.delivery_type === 'manual' ? t('products.cardsDisabledForManual') : ''"
                @click="$router.push('/products/' + row.id + '/cards')"
              >
                {{ t('cards.title') }}
              </button>
            </div>
          </template>
        </DataTable>
      </div>
    </div>

    <PaginationBar v-model:page="currentPage" :total="products.length" :page-size="pageSize" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'
import PaginationBar from '@/components/ui/PaginationBar.vue'
import ProductImage from '@/components/ui/ProductImage.vue'

const { t } = useI18n()
const DEFAULT_IMAGE = ref('/default-product.svg')
const products = ref<any[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)

const columns = computed<DataColumn[]>(() => [
  { key: 'id', label: t('common.id'), width: '70px' },
  { slot: 'image', label: '', width: '70px' },
  { key: 'name', label: t('common.name') },
  { slot: 'category', label: t('products.category') },
  { slot: 'delivery', label: t('products.deliveryType'), width: '130px' },
  { slot: 'price', label: t('common.price'), align: 'right' },
  { key: 'available', label: t('products.stock'), width: '80px', align: 'center' },
  { slot: 'actions', label: t('common.actions'), width: '170px' },
])

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
