import React, { useEffect, useState } from 'react';
import { buildUrl, createOne, useGetAll } from './swr';
import { io } from 'socket.io-client';
import {
  ShoppingCart,
  Plus,
  ArrowLeft,
  ChefHat,
  CheckCircle2,
  Beef,
  Pizza,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MenuItem, Category, Order } from './types';

// --- Components ---

const Button = ({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'gold';
  className?: string;
  disabled?: boolean;
}) => {
  const variants = {
    primary: 'bg-burger-black text-white hover:bg-black shadow-lg shadow-black/5',
    secondary: 'bg-zinc-100 text-burger-black hover:bg-zinc-200',
    outline: 'border-2 border-burger-black text-burger-black hover:bg-burger-black hover:text-white',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
    ghost: 'bg-transparent text-zinc-600 hover:bg-zinc-100',
    gold: 'bg-burger-orange text-white hover:bg-burger-red shadow-lg shadow-burger-orange/20',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-8 py-4 rounded-2xl font-black uppercase tracking-tight transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

// --- Main App ---

export default function App() {
  const [customerView, setCustomerView] = useState<'welcome' | 'menu' | 'cart' | 'receipt'>('welcome');
  const [cart, setCart] = useState<{ menuItemId: string; quantity: number }[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [tableNumber, setTableNumber] = useState('—');
  const [businessName, setBusinessName] = useState('Vick');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const menuResource = tableId ? `api/customer/menu/${tableId}` : null;
  const { data: menuData, error: menuError, isLoading: menuLoading } = useGetAll<any>(menuResource);
  const paymentMethodsResource = tableId ? `api/customer/payment-methods/${tableId}` : null;
  const { data: paymentData } = useGetAll<any>(paymentMethodsResource);
  const [invalidTable, setInvalidTable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>('');
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(5);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const currency = 'ETB';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('tableId');
    if (!id) {
      setInvalidTable(true);
      setLoading(false);
      return;
    }
    setTableId(id);
  }, []);

  useEffect(() => {
    if (!tableId) return;
    if (menuLoading) {
      setLoading(true);
      return;
    }
    if (menuError || !menuData?.data) {
      setInvalidTable(true);
      setLoading(false);
      return;
    }
    const data = menuData.data;
    const items: MenuItem[] = (data.categories || []).flatMap((cat: any) =>
      (cat.items || []).map((item: any) => ({
        id: item.itemId,
        name: item.itemName,
        description: item.description || '',
        price: Number(item.price || 0),
        category: cat.categoryName,
            image: item.imageUrl ? buildUrl(item.imageUrl) : '',
        available: Boolean(item.availabilityStatus),
      }))
    );
    setMenuItems(items);
    setTableNumber(data.tableNumber || '—');
    setBusinessName(data.businessName || 'Vick');
    setQrCode(data.qrCode || null);
    setLoading(false);
  }, [tableId, menuData, menuError, menuLoading]);

  const paymentMethods = (paymentData?.data ?? []) as Array<{ id: string; name: string; type: string }>;
  const selectedPayment = paymentMethods.find((m) => m.id === selectedPaymentId) || paymentMethods[0];
  const selectedPaymentName = selectedPayment?.name || 'Cash';

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItemId === item.id);
      if (existing) return prev.map((i) => (i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { menuItemId: item.id, quantity: 1 }];
    });
  };

  const updateCartQuantity = (id: string, delta: number) => {
    setCart((prev) => prev.map((i) => (i.menuItemId === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)));
  };

  const cartTotal = cart.reduce((acc, item) => {
    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
    return acc + (menuItem?.price || 0) * item.quantity;
  }, 0);

  const placeOrder = async () => {
    if (!tableId) return;
    const payload = {
      tableId,
      paymentMethod: selectedPaymentName,
      items: cart.map((i) => ({ itemId: i.menuItemId, quantity: i.quantity })),
    };
    const data = await createOne<any>('api/customer/orders', payload);
    const order = data?.data;
    const newOrder: Order = {
      id: order?.id || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      tableNumber,
      businessId: order?.table?.businessId || '',
      items: cart.map((i) => {
        const menuItem = menuItems.find((m) => m.id === i.menuItemId)!;
        return { ...i, name: menuItem.name, price: menuItem.price };
      }),
      total: cartTotal,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
    setLastOrder(newOrder);
    setCart([]);
    if (selectedPayment?.type === 'chapa') {
      const returnUrl = `${window.location.origin}/?tableId=${tableId}`;
      const init = await createOne<any>(`api/customer/orders/${order?.id}/chapa/init`, { returnUrl });
      const checkoutUrl = init?.data?.checkoutUrl;
      const txRef = init?.data?.txRef;
      if (txRef) {
        localStorage.setItem('pending_chapa_tx', txRef);
        localStorage.setItem('pending_chapa_order', order?.id || '');
      }
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
    }
    setCustomerView('receipt');
  };

  const FloatingIcons = () => (
    <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.05]">
      <motion.div
        animate={{
          y: [0, -20, 0],
          rotate: [0, 5, 0],
        }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-20 left-10"
      >
        <Beef size={120} />
      </motion.div>
      <motion.div
        animate={{
          y: [0, 20, 0],
          rotate: [0, -5, 0],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute top-40 right-[-20px]"
      >
        <Pizza size={150} />
      </motion.div>
      <motion.div
        animate={{
          x: [0, 15, 0],
          rotate: [0, 10, 0],
        }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute bottom-60 left-[-30px]"
      >
        <Pizza size={100} />
      </motion.div>
      <motion.div
        animate={{
          x: [0, -15, 0],
          rotate: [0, -10, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
        className="absolute bottom-20 right-10"
      >
        <Beef size={140} />
      </motion.div>
    </div>
  );

  const CustomerMenu = () => {
    const featuredItem = menuItems[0];

    return (
      <div className="pb-24 bg-burger-cream min-h-screen relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.03] pointer-events-none" />
        <FloatingIcons />

        <header className="px-8 pt-12 pb-8 sticky top-0 bg-burger-cream/95 backdrop-blur-xl z-20 border-b-2 border-burger-black/5">
          <div className="flex justify-between items-end mb-10">
            <div>
              <h1 className="font-black text-5xl text-burger-black tracking-tighter uppercase leading-none font-display">
                {businessName}<span className="text-burger-orange">.</span>
              </h1>
              <p className="text-burger-black/40 text-[10px] uppercase tracking-[0.4em] font-black mt-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-burger-orange rounded-full animate-pulse" />
                Table {tableNumber} - Est. 2024
              </p>
            </div>
            <button
              onClick={() => setCustomerView('cart')}
              className="relative p-5 bg-burger-black rounded-[1.5rem] shadow-2xl shadow-burger-black/20 hover:scale-105 active:scale-95 transition-all group"
            >
              <ShoppingCart size={24} className="text-white group-hover:rotate-12 transition-transform" />
              {cart.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-burger-orange text-white text-[10px] font-black w-7 h-7 flex items-center justify-center rounded-full shadow-lg border-4 border-burger-cream">
                  {cart.reduce((a, b) => a + b.quantity, 0)}
                </span>
              )}
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
            {['All', ...Array.from(new Set(menuItems.map((m) => m.category)))].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat as Category | 'All')}
                className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border-2 ${
                  selectedCategory === cat
                    ? 'bg-burger-black text-white border-burger-black shadow-xl shadow-burger-black/10'
                    : 'bg-white text-burger-black/30 border-burger-black/5 hover:border-burger-black/20'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </header>

        <div className="px-8 mt-10 space-y-12">
          {selectedCategory === 'All' && featuredItem && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative group cursor-pointer"
              onClick={() => addToCart(featuredItem)}
            >
              <div className="absolute -top-3 left-4 z-10 bg-burger-orange text-white px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-lg rotate-[-2deg]">
                Chef's Pick
              </div>
              <div className="relative aspect-[16/9] overflow-hidden rounded-[2rem] shadow-2xl shadow-burger-black/10 border-4 border-white">
                <img
                  src={featuredItem.image}
                  alt={featuredItem.name}
                  className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-burger-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-6 left-6 right-6 text-white">
                  <h2 className="text-2xl font-black uppercase tracking-tighter leading-none mb-1">{featuredItem.name}</h2>
                  <div className="flex justify-between items-center">
                    <span className="text-xl font-black text-burger-yellow">{currency} {featuredItem.price.toFixed(0)}</span>
                    <div className="w-10 h-10 bg-white text-burger-black rounded-xl flex items-center justify-center shadow-xl">
                      <Plus size={20} strokeWidth={3} />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-10">
            {menuItems
              .filter((item) => (selectedCategory === 'All' || item.category === selectedCategory) && (selectedCategory !== 'All' || item.id !== 'b2'))
              .map((item) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  key={item.id}
                  className="group flex flex-col"
                >
                  <div className="relative aspect-square overflow-hidden rounded-[1.5rem] mb-4 shadow-xl shadow-burger-black/5 border-2 border-white">
                    <img
                      src={item.image}
                      alt={item.name}
                      className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 ${!item.available && 'grayscale opacity-50'}`}
                      referrerPolicy="no-referrer"
                    />
                    {!item.available && (
                      <div className="absolute inset-0 bg-burger-black/40 backdrop-blur-[1px] flex items-center justify-center">
                        <span className="bg-white px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest text-burger-black">Sold Out</span>
                      </div>
                    )}
                    <div className="absolute bottom-3 right-3">
                      {item.available && (
                        <button
                          onClick={() => addToCart(item)}
                          className="w-10 h-10 bg-burger-orange text-white rounded-xl flex items-center justify-center shadow-lg shadow-burger-orange/30 hover:scale-110 active:scale-90 transition-all border-2 border-white"
                        >
                          <Plus size={20} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 px-1 flex-1 flex flex-col">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-black text-sm text-burger-black leading-tight uppercase tracking-tighter font-display line-clamp-2">
                        {item.name}
                      </h3>
                    </div>
                    <div className="mt-auto pt-1">
                      <span className="font-black text-xs text-burger-orange">{currency} {item.price.toFixed(0)}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
          </div>
        </div>
      </div>
    );
  };

  function ReceiptView() {
    return (
      <div className="min-h-screen bg-burger-cream flex flex-col items-center justify-center p-8">
        <div className="bg-white w-full max-w-md rounded-[4rem] shadow-2xl shadow-burger-black/10 overflow-hidden border-4 border-burger-black">
          <div className="bg-burger-black p-12 text-center text-white relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
              <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-radial-gradient from-burger-orange to-transparent" />
            </div>
            <div className="w-24 h-24 bg-burger-orange rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-burger-orange/40 rotate-6">
              <CheckCircle2 size={48} strokeWidth={3} />
            </div>
            <h2 className="font-black text-4xl uppercase tracking-tighter leading-none">Order<br />Confirmed</h2>
            <p className="text-[10px] uppercase tracking-[0.4em] font-black text-white/40 mt-4">Get ready to feast</p>
          </div>
          <div className="p-12 space-y-12 text-center">
            <div className="space-y-3">
              <p className="text-burger-black/40 text-[10px] uppercase tracking-[0.3em] font-black">Your Table</p>
              <p className="text-8xl font-black text-burger-black tracking-tighter leading-none">{tableNumber}</p>
            </div>
            <div className="pt-10 border-t-4 border-dashed border-burger-cream space-y-6">
              <p className="text-sm text-burger-black/60 font-bold uppercase tracking-tight leading-relaxed">
                Our chefs are firing up the grill. Your order ID is <span className="text-burger-orange">{lastOrder?.id}</span>
              </p>
              <Button onClick={() => setCustomerView('menu')} variant="gold" className="w-full">Back to Menu</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const txRef = localStorage.getItem('pending_chapa_tx');
    const orderId = localStorage.getItem('pending_chapa_order');
    if (txRef && orderId) {
      fetch(buildUrl(`/api/customer/orders/${orderId}/chapa/verify?tx_ref=${encodeURIComponent(txRef)}`))
        .finally(() => {
          localStorage.removeItem('pending_chapa_tx');
          localStorage.removeItem('pending_chapa_order');
        });
    }
  }, []);

  useEffect(() => {
    if (!tableId || !qrCode) return;
    const socket = io(buildUrl(''), { auth: {} });
    socket.emit('join-table', { tableId, qrCode });
    socket.on('OrderStatusUpdated', (payload: any) => {
      if (payload?.tableId !== tableId) return;
      if (String(payload?.status).toLowerCase() === 'delivered') {
        setPendingOrderId(payload?.orderId || null);
        setShowRating(true);
      }
    });
    return () => {
      socket.disconnect();
    };
  }, [tableId, qrCode]);

  const submitRating = async (value: number) => {
    if (!tableId) return;
    await fetch(buildUrl(`/api/customer/tables/${tableId}/rate`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: value }),
    });
    setShowRating(false);
    setPendingOrderId(null);
  };

  if (loading || invalidTable) {
    return null;
  }

  return (
    <div className="font-sans text-zinc-900 selection:bg-black selection:text-white">
      <AnimatePresence mode="wait">
        {customerView === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="min-h-screen bg-burger-black flex flex-col items-center justify-center p-12 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-grid-pattern opacity-10 pointer-events-none" />
            <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-radial-gradient from-burger-orange/20 to-transparent pointer-events-none" />
            <FloatingIcons />

            <motion.div
              initial={{ scale: 0.8, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', damping: 12 }}
              className="w-32 h-32 bg-burger-orange rounded-[2.5rem] flex items-center justify-center mb-12 shadow-2xl shadow-burger-orange/40"
            >
              <ChefHat size={64} className="text-white" />
            </motion.div>

            <h1 className="text-6xl font-black text-white uppercase tracking-tighter leading-none mb-6 font-display">
              Welcome to <span className="text-burger-orange">{businessName}.</span>
            </h1>
            <p className="text-white/40 text-sm font-bold uppercase tracking-[0.3em] mb-12">Hand-crafted Burgers and More</p>

            <Button onClick={() => setCustomerView('menu')} variant="gold" className="w-full text-lg py-6">
              View Menu
            </Button>

            <p className="mt-12 text-[10px] font-black text-white/20 uppercase tracking-widest">Table {tableNumber} - Scan to Order</p>
          </motion.div>
        )}
        {customerView === 'menu' && (
          <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-md mx-auto min-h-screen bg-white shadow-2xl relative">
            <CustomerMenu />
          </motion.div>
        )}
        {customerView === 'cart' && (
          <motion.div key="cart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="min-h-screen bg-burger-cream p-8 flex flex-col relative overflow-hidden">
              <FloatingIcons />
              <header className="flex items-center gap-4 mb-12 relative z-10">
                <button onClick={() => setCustomerView('menu')} className="p-4 bg-white rounded-2xl shadow-lg">
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-3xl font-black uppercase tracking-tighter font-display">Your Order</h2>
              </header>

              <div className="flex-1 space-y-6 overflow-y-auto no-scrollbar relative z-10">
                {cart.length === 0 ? (
                  <div className="text-center py-20">
                    <ShoppingCart size={64} className="mx-auto text-burger-black/5 mb-6" />
                    <p className="text-burger-black/40 font-black uppercase tracking-tight">Your cart is empty</p>
                  </div>
                ) : (
                  cart.map((item) => {
                    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
                    return (
                      <div key={item.menuItemId} className="bg-white p-6 rounded-3xl flex gap-6 items-center shadow-xl shadow-burger-black/5 border-2 border-burger-black/5">
                        <img src={menuItem?.image} className="w-20 h-20 rounded-2xl object-cover" referrerPolicy="no-referrer" />
                        <div className="flex-1">
                          <h4 className="font-black uppercase tracking-tight text-lg">{menuItem?.name}</h4>
                          <p className="text-burger-orange font-black">{currency} {menuItem?.price.toFixed(0)}</p>
                        </div>
                        <div className="flex items-center gap-4 bg-burger-cream p-2 rounded-2xl">
                          <button onClick={() => updateCartQuantity(item.menuItemId, -1)} className="w-8 h-8 flex items-center justify-center font-black text-xl">-</button>
                          <span className="font-black w-4 text-center">{item.quantity}</span>
                          <button onClick={() => updateCartQuantity(item.menuItemId, 1)} className="w-8 h-8 flex items-center justify-center font-black text-xl">+</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {cart.length > 0 && (
                <div className="mt-8 p-8 bg-burger-black rounded-[3rem] text-white space-y-6 shadow-2xl shadow-burger-black/40 relative z-10">
                  {paymentMethods.length > 0 && (
                    <div className="space-y-3">
                      <span className="text-white/40 font-black uppercase tracking-widest text-xs">Payment Method</span>
                      <div className="flex flex-wrap gap-2">
                        {paymentMethods.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedPaymentId(m.id)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition ${
                              (selectedPaymentId ? selectedPaymentId === m.id : paymentMethods[0]?.id === m.id)
                                ? 'bg-burger-orange text-white border-burger-orange'
                                : 'bg-transparent text-white/60 border-white/20'
                            }`}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-white/40 font-black uppercase tracking-widest text-xs">Total Amount</span>
                    <span className="text-3xl font-black text-burger-yellow">{currency} {cartTotal.toFixed(0)}</span>
                  </div>
                  <Button onClick={placeOrder} variant="gold" className="w-full py-6 text-lg">Place Order</Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
        {customerView === 'receipt' && (
          <motion.div key="receipt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ReceiptView />
          </motion.div>
        )}
      </AnimatePresence>
      {showRating && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 text-center space-y-6 border-4 border-burger-black">
            <h3 className="text-2xl font-black uppercase tracking-tight">Rate Our Service</h3>
            <p className="text-xs text-zinc-500">Order {pendingOrderId || ''}</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setRatingValue(v)}
                  className={`w-12 h-12 rounded-2xl font-black ${ratingValue === v ? 'bg-burger-orange text-white' : 'bg-zinc-100 text-zinc-500'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRating(false)}
                className="flex-1 px-6 py-3 rounded-2xl font-black uppercase tracking-tight bg-zinc-100 text-zinc-600"
              >
                Skip
              </button>
              <button
                onClick={() => submitRating(ratingValue)}
                className="flex-1 px-6 py-3 rounded-2xl font-black uppercase tracking-tight bg-burger-black text-white"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
