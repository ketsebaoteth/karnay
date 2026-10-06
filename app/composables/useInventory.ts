import { ref, toRaw } from 'vue'
import localForage from 'localforage'
import type { InventoryItem, SaleRecord } from '~/types/inventory'

const items = ref<InventoryItem[]>([])
const salesHistory = ref<SaleRecord[]>([])
let isInitialized = false

export const useInventory = () => {
  const db = localForage.createInstance({ name: 'MomApp', storeName: 'inventory' })
  const salesDb = localForage.createInstance({ name: 'MomApp', storeName: 'sales' })

  const loadItems = async () => {
    const allItems: InventoryItem[] = []
    await db.iterate((value) => {
      if (value) allItems.push(value as InventoryItem)
    })
    items.value = allItems.sort((a, b) => a.name.localeCompare(b.name))
  }

  const loadSales = async () => {
    const allSales: SaleRecord[] = []
    await salesDb.iterate((value) => {
      if (value) allSales.push(value as SaleRecord)
    })
    salesHistory.value = allSales.sort((a, b) => b.date.localeCompare(a.date))
  }

  const saveItem = async (item: InventoryItem) => {
    const rawItem = JSON.parse(JSON.stringify(toRaw(item)))
    await db.setItem(rawItem.id, rawItem)
    await loadItems()
  }

  /* CSV bulk import — disabled for now
  const saveItemsBulk = async (newItems: InventoryItem[]) => {
    for (const item of newItems) {
      const rawItem = JSON.parse(JSON.stringify(toRaw(item)))
      await db.setItem(rawItem.id, rawItem)
    }
    await loadItems()
  }
  */

  const deleteItem = async (id: string) => {
    await db.removeItem(id)
    await loadItems()
  }

  const recordSale = async (cartItems: Array<{
    id: string
    name: string
    price: number
    quantity: number
  }>) => {
    const rawCartItems = JSON.parse(JSON.stringify(toRaw(cartItems)))
    let totalRevenue = 0
    let totalCost = 0

    const enrichedItems = rawCartItems.map((cartItem: {
      id: string
      name: string
      price: number
      quantity: number
    }) => {
      const liveItem = items.value.find(i => i.id === cartItem.id)
      // Prefer live wholesale cost; never fall back to retail price (that zeros profit)
      const buyingPrice = liveItem?.buyingPrice ?? 0

      totalRevenue += cartItem.price * cartItem.quantity
      totalCost += buyingPrice * cartItem.quantity

      return { ...cartItem, buyingPrice }
    })

    // Re-check stock so we never go negative on double-submit or stale carts
    for (const cartItem of enrichedItems) {
      const item = items.value.find(i => i.id === cartItem.id)
      if (!item || item.quantity < cartItem.quantity) {
        throw new Error(`Not enough stock for "${cartItem.name}"`)
      }
    }

    const sale: SaleRecord = {
      id: 'sale_' + Date.now(),
      date: new Date().toISOString(),
      items: enrichedItems,
      total: totalRevenue,
      profit: totalRevenue - totalCost
    }

    await salesDb.setItem(sale.id, sale)

    for (const cartItem of enrichedItems) {
      const item = items.value.find(i => i.id === cartItem.id)
      if (item) {
        item.quantity -= cartItem.quantity
        item.lastUpdated = new Date().toISOString()
        await db.setItem(item.id, JSON.parse(JSON.stringify(toRaw(item))))
      }
    }

    await Promise.all([loadItems(), loadSales()])
  }

  const clearAllItems = async (): Promise<boolean> => {
    await db.clear()
    items.value = []
    return true
  }

  if (import.meta.client && !isInitialized) {
    isInitialized = true
    loadItems()
    loadSales()
  }

  return {
    items,
    salesHistory,
    saveItem,
    // saveItemsBulk, // CSV import disabled
    deleteItem,
    recordSale,
    loadItems,
    clearAllItems
  }
}
