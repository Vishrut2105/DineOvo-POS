import React, { useState } from 'react';
import { SessionProvider, useSession } from './context/SessionContext';
import Header from './components/Header';
import ServiceBar from './components/ServiceBar';
import BottomNav from './components/BottomNav';
import Toast from './components/Toast';
import MenuTab from './components/Menu/MenuTab';
import OrdersTab from './components/Orders/OrdersTab';
import ReviewsTab from './components/Reviews/ReviewsTab';
import ArcadeTab from './components/Arcade/ArcadeTab';
import CartSheet from './components/Cart/CartSheet';
import OrderSuccessModal from './components/Cart/OrderSuccessModal';
import Loader from './components/Loader';

function MainApp() {
  const [activeTab, setActiveTab] = useState('menu');
  const [direction, setDirection] = useState('forward');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [successOrderId, setSuccessOrderId] = useState(null);

  const { cartDetails } = useSession();

  const tabOrder = ['menu', 'orders', 'reviews', 'arcade'];

  const handleTabChange = (newTab) => {
    if (newTab === activeTab) return;
    const oldIdx = tabOrder.indexOf(activeTab);
    const newIdx = tabOrder.indexOf(newTab);
    setDirection(newIdx >= oldIdx ? 'forward' : 'backward');
    setActiveTab(newTab);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleOrderSent = (orderId) => {
    setSuccessOrderId(orderId);
  };

  const handleTrackOrder = () => {
    setSuccessOrderId(null);
    handleTabChange('orders');
  };

  const handlePlayGames = () => {
    setSuccessOrderId(null);
    handleTabChange('arcade');
  };

  return (
    <div className="mobile-shell">
      <Header />
      <ServiceBar />

      <main style={{ paddingBottom: '16px', minHeight: 'calc(100vh - 140px)' }}>
        <div
          key={activeTab}
          className={`page-transition-wrapper page-transition-${direction}`}
        >
          {activeTab === 'menu' && <MenuTab />}
          {activeTab === 'orders' && <OrdersTab onBrowseMenu={() => handleTabChange('menu')} />}
          {activeTab === 'reviews' && <ReviewsTab />}
          {activeTab === 'arcade' && <ArcadeTab />}
        </div>
      </main>

      {/* Floating Cart Pill (Only on Menu tab when cart has items) */}
      {activeTab === 'menu' && cartDetails.count > 0 && (
        <button
          type="button"
          className="floating-cart-pill"
          onClick={() => setIsCartOpen(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="fcp-badge">{cartDetails.count}</span>
            <span className="fcp-text">View Order Ticket</span>
          </div>
          <span className="fcp-total">₹{cartDetails.total}</span>
        </button>
      )}

      {/* Cart Sheet Drawer */}
      <CartSheet
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onOrderSent={handleOrderSent}
      />

      {/* Order Celebration Modal */}
      <OrderSuccessModal
        isOpen={Boolean(successOrderId)}
        orderId={successOrderId}
        onClose={() => setSuccessOrderId(null)}
        onTrackOrder={handleTrackOrder}
        onPlayGames={handlePlayGames}
      />

      <Toast />
      <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />
      <Loader />
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <div className="bg-mesh" />
      <MainApp />
    </SessionProvider>
  );
}
