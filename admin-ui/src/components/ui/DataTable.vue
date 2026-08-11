<template>
  <div class="relative">
    <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center rounded-box bg-base-100/70">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
    <div class="overflow-x-auto">
      <table class="table table-sm table-zebra">
        <thead>
          <tr>
            <th
              v-for="col in columns"
              :key="col.label"
              :style="col.width ? { width: col.width } : undefined"
              :class="alignClass(col.align)"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td v-for="col in columns" :key="col.label" :class="alignClass(col.align)">
              <slot v-if="col.slot" :name="col.slot" :row="row" :index="i">{{ cellText(col, row) }}</slot>
              <template v-else>{{ cellText(col, row) }}</template>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td :colspan="columns.length" class="py-10 text-center text-sm opacity-60">{{ emptyText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface DataColumn {
  label: string
  key?: string
  width?: string
  align?: 'left' | 'center' | 'right'
  slot?: string
  formatter?: (row: any) => string
}

withDefaults(
  defineProps<{
    columns: DataColumn[]
    rows: any[]
    loading?: boolean
    emptyText?: string
  }>(),
  {
    loading: false,
    emptyText: '暂无数据',
  },
)

function cellText(col: DataColumn, row: any) {
  if (col.formatter) return col.formatter(row)
  if (col.key) return row[col.key] ?? '-'
  return '-'
}

function alignClass(align?: 'left' | 'center' | 'right') {
  return { left: 'text-left', center: 'text-center', right: 'text-right' }[align || 'left']
}
</script>
