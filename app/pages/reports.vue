<script setup lang="ts">
import type { SaleRecord } from '~/types/inventory'
import {
  type Timeframe,
  getPeriodBounds,
  getPreviousPeriodBounds,
  isInRange,
  dayKey,
  formatDayLabel,
  shiftDate
} from '~/utils/dateRanges'

const { items, salesHistory } = useInventory()
const activeTimeframe = ref<Timeframe>('day')
const periodOffset = ref(0)
const customStart = ref(new Date().toISOString().split('T')[0])
const customEnd = ref(new Date().toISOString().split('T')[0])

watch(activeTimeframe, () => {
  periodOffset.value = 0
})

type ItemAgg = {
  id: string
  name: string
  price: number
  soldCount: number
  profitGenerated: number
  buyingPrice: number
}

function aggregateSales(filteredSales: SaleRecord[]) {
  let totalRevenue = 0
  let totalProfit = 0
  let totalSalesCount = 0
  const itemSalesMap = new Map<string, ItemAgg>()
  const dailyMap = new Map<string, { revenue: number; profit: number; units: number; orders: number }>()

  filteredSales.forEach(sale => {
    totalSalesCount += sale.items.reduce((sum, i) => sum + i.quantity, 0)
    totalRevenue += sale.total || 0

    let saleProfit: number
    if (typeof sale.profit === 'number') {
      saleProfit = sale.profit
    } else {
      let saleCost = 0
      sale.items.forEach(si => {
        saleCost += (si.buyingPrice ?? 0) * si.quantity
      })
      saleProfit = (sale.total || 0) - saleCost
    }
    totalProfit += saleProfit

    const key = dayKey(sale.date)
    if (!dailyMap.has(key)) {
      dailyMap.set(key, { revenue: 0, profit: 0, units: 0, orders: 0 })
    }
    const dayEntry = dailyMap.get(key)!
    dayEntry.revenue += sale.total || 0
    dayEntry.profit += saleProfit
    dayEntry.units += sale.items.reduce((sum, i) => sum + i.quantity, 0)
    dayEntry.orders += 1

    sale.items.forEach(soldItem => {
      if (!itemSalesMap.has(soldItem.id)) {
        itemSalesMap.set(soldItem.id, {
          id: soldItem.id,
          name: soldItem.name,
          price: soldItem.price,
          soldCount: 0,
          profitGenerated: 0,
          buyingPrice: soldItem.buyingPrice ?? 0
        })
      }
      const entry = itemSalesMap.get(soldItem.id)!
      entry.soldCount += soldItem.quantity
      entry.profitGenerated += (soldItem.price - (soldItem.buyingPrice ?? 0)) * soldItem.quantity
    })
  })

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([key, stats]) => ({ key, label: formatDayLabel(key), ...stats }))
    .sort((a, b) => b.key.localeCompare(a.key))

  return {
    totalRevenue,
    totalProfit,
    totalSalesCount,
    itemSalesMap,
    dailyBreakdown,
    orderCount: filteredSales.length
  }
}

function getReferenceDate() {
  return shiftDate(new Date(), activeTimeframe.value, periodOffset.value)
}

const reportMetrics = computed(() => {
  const allSales = salesHistory.value || []
  const refDate = getReferenceDate()
  
  const cStart = new Date(customStart.value)
  const cEnd = new Date(customEnd.value)

  const currentBounds = getPeriodBounds(activeTimeframe.value, refDate, cStart, cEnd)
  const previousBounds = getPreviousPeriodBounds(activeTimeframe.value, refDate, cStart, cEnd)

  const filteredSales = allSales.filter(sale => isInRange(sale.date, currentBounds.start, currentBounds.end))
  const previousSales = allSales.filter(sale => isInRange(sale.date, previousBounds.start, previousBounds.end))

  const current = aggregateSales(filteredSales)
  const previous = aggregateSales(previousSales)

  let totalValueDecreased = 0
  const productValueShifts = items.value.map(item => {
    const saleEntry = current.itemSalesMap.get(item.id)
    const quantitySoldInWindow = saleEntry ? saleEntry.soldCount : 0
    const costBasis = item.buyingPrice ?? saleEntry?.buyingPrice ?? 0

    const currentValue = item.quantity * costBasis
    const valueLostInSales = quantitySoldInWindow * costBasis
    const initialValue = currentValue + valueLostInSales

    totalValueDecreased += valueLostInSales

    return {
      id: item.id,
      name: item.name,
      initialValue,
      currentValue,
      valueLostInSales
    }
  }).sort((a, b) => b.valueLostInSales - a.valueLostInSales)

  const performanceList = Array.from(current.itemSalesMap.values())
    .sort((a, b) => b.profitGenerated - a.profitGenerated)

  const deadStockList = items.value.filter(item => !current.itemSalesMap.has(item.id))
  const lowStockList = items.value.filter(item => item.quantity <= 3)

  const totalCurrentStoreValue = items.value.reduce((sum, item) => {
    return sum + ((item.buyingPrice ?? 0) * item.quantity)
  }, 0)

  const periodLabel = (() => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
    if (activeTimeframe.value === 'custom') {
      return `${cStart.toLocaleDateString(undefined, opts)} – ${cEnd.toLocaleDateString(undefined, opts)}`
    }
    if (activeTimeframe.value === 'day') {
      return currentBounds.start.toLocaleDateString(undefined, { ...opts, weekday: 'short' })
    }
    if (activeTimeframe.value === 'week') {
      return `Week starting ${currentBounds.start.toLocaleDateString(undefined, opts)}`
    }
    return currentBounds.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  })()

  let revenueChange = 0
  if (previous.totalRevenue > 0) {
    revenueChange = ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100
  } else if (current.totalRevenue > 0) {
    revenueChange = 100
  }
  
  let profitChange = 0
  if (previous.totalProfit > 0) {
    profitChange = ((current.totalProfit - previous.totalProfit) / previous.totalProfit) * 100
  } else if (current.totalProfit > 0) {
    profitChange = 100
  }

  return {
    totalRevenue: current.totalRevenue,
    totalProfit: current.totalProfit,
    totalSalesCount: current.totalSalesCount,
    orderCount: current.orderCount,
    totalCurrentStoreValue,
    totalValueDecreased,
    productValueShifts,
    performanceList,
    deadStockList,
    lowStockList,
    dailyBreakdown: current.dailyBreakdown,
    periodLabel,
    prevRevenue: previous.totalRevenue,
    prevProfit: previous.totalProfit,
    revenueChange: Math.round(revenueChange),
    profitChange: Math.round(profitChange)
  }
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-white p-6 pb-24 select-none">
    <div class="max-w-5xl mx-auto">

      <div class="mb-6 border-b border-zinc-900 pb-5">
        <NuxtLink to="/"
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1">
          ← Return to Inventory
        </NuxtLink>
        <h1 class="text-3xl font-black tracking-tight mt-1">Shop Sales</h1>
        <p class="text-zinc-500 text-xs mt-1">View revenue, profit, and trends over time</p>
      </div>

      <!-- Timeframe Tabs -->
      <div class="flex gap-2 mb-6 overflow-x-auto no-scrollbar pb-2">
        <button v-for="tf in ['day', 'week', 'month', 'custom']" :key="tf"
          @click="activeTimeframe = tf as Timeframe"
          :class="activeTimeframe === tf ? 'bg-zinc-800 text-white border-zinc-700' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800/60'"
          class="px-5 py-2.5 rounded-xl text-sm font-bold capitalize border transition-colors shrink-0">
          {{ tf }}
        </button>
      </div>

      <!-- Navigation & Custom Pickers -->
      <div class="flex items-center justify-between mb-6 bg-zinc-900/50 p-2 border border-zinc-800 rounded-2xl">
        <template v-if="activeTimeframe !== 'custom'">
          <button @click="periodOffset--" class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold transition-colors text-zinc-300">
            &larr; Prev
          </button>
          
          <div class="font-black text-sm tracking-tight text-white flex-1 text-center">
            {{ reportMetrics.periodLabel }}
          </div>
          
          <button @click="periodOffset++" :disabled="periodOffset === 0" 
            class="px-4 py-2 bg-zinc-800 rounded-xl text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-700 text-zinc-300">
            Next &rarr;
          </button>
        </template>
        
        <template v-else>
          <div class="flex flex-col sm:flex-row items-center gap-3 w-full p-2">
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <label class="text-xs font-bold text-zinc-500 uppercase">Start</label>
              <input type="date" v-model="customStart" class="bg-zinc-800 text-sm border border-zinc-700 rounded-lg px-3 py-1.5 focus:outline-none focus:border-zinc-500" />
            </div>
            <span class="text-zinc-600 hidden sm:inline">&rarr;</span>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <label class="text-xs font-bold text-zinc-500 uppercase">End</label>
              <input type="date" v-model="customEnd" class="bg-zinc-800 text-sm border border-zinc-700 rounded-lg px-3 py-1.5 focus:outline-none focus:border-zinc-500" />
            </div>
          </div>
        </template>
      </div>

      <!-- Unified Sales Overview Card -->
      <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 pl-1">Period Overview</h2>
      
      <div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-8 mb-10 grid grid-cols-1 md:grid-cols-3 gap-6 relative overflow-hidden">
        
        <div class="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none"></div>

        <div class="flex flex-col gap-2">
          <div class="text-zinc-500 font-bold text-[11px] uppercase tracking-widest flex items-center gap-2">
            Sales Revenue
            <span v-if="reportMetrics.revenueChange !== 0" :class="reportMetrics.revenueChange > 0 ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'" class="px-2 py-0.5 rounded-full text-[10px] font-black">
              {{ reportMetrics.revenueChange > 0 ? '↑' : '↓' }} {{ Math.abs(reportMetrics.revenueChange) }}%
            </span>
          </div>
          <div class="text-4xl font-black font-mono text-white">
            {{ reportMetrics.totalRevenue.toLocaleString() }} <span class="text-base text-zinc-500 font-normal">ETB</span>
          </div>
        </div>

        <div class="flex flex-col gap-2 border-l-0 md:border-l border-zinc-800/80 md:pl-6">
          <div class="text-zinc-500 font-bold text-[11px] uppercase tracking-widest flex items-center gap-2">
            Gross Profit
            <span v-if="reportMetrics.profitChange !== 0" :class="reportMetrics.profitChange > 0 ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'" class="px-2 py-0.5 rounded-full text-[10px] font-black">
              {{ reportMetrics.profitChange > 0 ? '↑' : '↓' }} {{ Math.abs(reportMetrics.profitChange) }}%
            </span>
          </div>
          <div class="text-4xl font-black font-mono text-emerald-400">
            {{ reportMetrics.totalProfit.toLocaleString() }} <span class="text-base text-emerald-400/50 font-normal">ETB</span>
          </div>
        </div>
        
        <div class="flex flex-col gap-2 border-l-0 md:border-l border-zinc-800/80 md:pl-6 justify-center">
          <div class="flex justify-between items-center bg-zinc-800/50 rounded-xl p-3">
            <span class="text-xs text-zinc-400 font-bold">Units Sold</span>
            <span class="text-sm text-white font-black">{{ reportMetrics.totalSalesCount }}</span>
          </div>
          <div class="flex justify-between items-center bg-zinc-800/50 rounded-xl p-3">
            <span class="text-xs text-zinc-400 font-bold">Total Orders</span>
            <span class="text-sm text-white font-black">{{ reportMetrics.orderCount }}</span>
          </div>
        </div>
      </div>

      <!-- Per-day breakdown inside week / month / custom -->
      <div v-if="activeTimeframe !== 'day'" class="mb-8">
        <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 pl-1">
          Sales by Day
        </h2>
        <div v-if="reportMetrics.dailyBreakdown.length === 0"
          class="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl p-6 text-center text-zinc-600 text-xs">
          No sales recorded in this period yet.
        </div>
        <div v-else class="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800/60">
          <div v-for="day in reportMetrics.dailyBreakdown" :key="day.key"
            class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span class="font-bold text-sm text-zinc-200 block">{{ day.label }}</span>
              <span class="text-[10px] text-zinc-500">{{ day.orders }} order{{ day.orders === 1 ? '' : 's' }} · {{ day.units }} pcs</span>
            </div>
            <div class="flex items-center gap-4 font-mono text-xs sm:text-sm">
              <div class="text-right">
                <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Sales</div>
                <div class="font-bold text-zinc-200">{{ day.revenue.toLocaleString() }} ETB</div>
              </div>
              <div class="text-right">
                <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Profit</div>
                <div class="font-black text-emerald-400">+{{ day.profit.toLocaleString() }} ETB</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div class="text-zinc-500 text-xs font-bold uppercase tracking-wider">Current Shelf Stock Value</div>
          <div class="text-2xl font-black text-white mt-2 font-mono">
            {{ reportMetrics.totalCurrentStoreValue.toLocaleString() }} <span class="text-sm font-normal text-zinc-500">ETB</span>
          </div>
        </div>
        <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div class="text-zinc-500 text-xs font-bold uppercase tracking-wider">Cost of Stock Sold (Period)</div>
          <div class="text-2xl font-black text-amber-500 mt-2 font-mono">
            -{{ reportMetrics.totalValueDecreased.toLocaleString() }} <span class="text-sm font-normal text-zinc-500">ETB</span>
          </div>
        </div>
      </div>

      <div v-if="reportMetrics.lowStockList.length > 0"
        class="mb-8 bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5">
        <h3 class="text-amber-500 text-xs font-black uppercase tracking-wider mb-3">
          Low Stock (≤ 3 left)
        </h3>
        <div class="flex flex-wrap gap-2">
          <div v-for="item in reportMetrics.lowStockList" :key="item.id"
            class="bg-zinc-950 border border-amber-500/10 px-3 py-2 rounded-xl text-xs flex items-center gap-3">
            <span class="font-bold text-zinc-300">{{ item.name }}</span>
            <span class="text-amber-400 font-black px-1.5 py-0.5 bg-amber-500/10 rounded-md">{{ item.quantity }} left</span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 pl-1">Top Sellers by Profit</h2>
          <div v-if="reportMetrics.performanceList.length === 0"
            class="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl p-6 text-center text-zinc-600 text-xs">
            No sales in this period yet.
          </div>
          <div v-else class="space-y-1.5">
            <div v-for="item in reportMetrics.performanceList" :key="item.id"
              class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between hover:bg-zinc-800/40 transition-colors">
              <div>
                <div class="font-bold text-sm text-zinc-200">{{ item.name }}</div>
                <div class="text-zinc-500 text-xs mt-0.5">{{ item.soldCount }} sold</div>
              </div>
              <div class="text-emerald-400 font-mono font-black text-sm">+{{ item.profitGenerated.toLocaleString() }} ETB</div>
            </div>
          </div>
        </div>

        <div>
           <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 pl-1">Unsold Inventory Focus</h2>
           <div v-if="reportMetrics.deadStockList.length === 0"
             class="text-emerald-400 bg-emerald-950/10 border border-emerald-900/30 rounded-xl p-4 text-center text-xs font-bold">
             Incredible! Every item sold this period.
           </div>
           <div v-else class="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1 pb-1">
             <div v-for="item in reportMetrics.deadStockList" :key="item.id"
               class="bg-zinc-900/30 border border-zinc-800/80 p-3 rounded-xl flex justify-between items-center text-xs">
               <div class="text-zinc-400 truncate pr-2 font-medium">{{ item.name }}</div>
               <span class="text-zinc-500 font-mono font-bold shrink-0">{{ item.quantity }}</span>
             </div>
           </div>
         </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* Hide scrollbar for tabs */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
