<template>
  <div class="relative">
    <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70">
      <Loader2 class="h-6 w-6 animate-spin text-primary" />
    </div>
    <div class="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              v-for="col in columns"
              :key="col.label"
              :style="col.width ? { width: col.width } : undefined"
              :class="alignClass(col.align)"
            >
              {{ col.label }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(row, i) in rows" :key="i">
            <TableCell v-for="col in columns" :key="col.label" :class="alignClass(col.align)">
              <slot v-if="col.slot" :name="col.slot" :row="row" :index="i">{{ cellText(col, row) }}</slot>
              <template v-else>{{ cellText(col, row) }}</template>
            </TableCell>
          </TableRow>
          <TableRow v-if="!rows.length && !loading">
            <TableCell :colspan="columns.length" class="h-24 text-center text-muted-foreground">
              {{ emptyText }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'

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
