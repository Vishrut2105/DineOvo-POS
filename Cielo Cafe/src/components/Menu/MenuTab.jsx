import React, { useState, useMemo } from 'react';
import { useSession } from '../../context/SessionContext';
import { Search, X, AlertCircle } from 'lucide-react';
import SpecialsSlider from './SpecialsSlider';
import CategoryPills from './CategoryPills';
import MenuCard from './MenuCard';

export default function MenuTab() {
  const { menuItems, menuLoading, mergeOrderId, setMergeOrderId } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set();
    menuItems.forEach(item => {
      if (item.category) set.add(item.category);
    });
    return Array.from(set);
  }, [menuItems]);

  // Filtered menu
  const filteredItems = useMemo(() => {
    let result = menuItems;
    if (activeCategory !== 'all') {
      result = result.filter(item => item.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(item =>
        item.name?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [menuItems, activeCategory, searchQuery]);

  // Group filtered items by category
  const groupedSections = useMemo(() => {
    const map = {};
    filteredItems.forEach(item => {
      const cat = item.category || 'Other';
      if (!map[cat]) map[cat] = [];
      map[cat].push(item);
    });
    return Object.entries(map);
  }, [filteredItems]);

  return (
    <div>
      {/* Reorder Merge Banner */}
      {mergeOrderId && (
        <div
          className="tactile-card"
          style={{
            background: 'var(--ember-soft)',
            borderColor: 'var(--tborder)',
            padding: '12px 14px',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} color="var(--ember)" />
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ember-ink)' }}>
              Adding extra items to Ticket #{mergeOrderId.substring(0, 8).toUpperCase()}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMergeOrderId(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink3)',
              cursor: 'pointer',
              padding: '2px'
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '14px' }}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '14px',
            transform: 'translateY(-50%)',
            color: 'var(--ink3)',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none'
          }}
        >
          <Search size={17} />
        </div>
        <input
          type="text"
          className="search-debossed"
          placeholder="Search artisan pizzas, bowls, coffee…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute',
              top: '50%',
              right: '14px',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: 'var(--ink3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Daily Specials Slider (Only shown when not actively searching) */}
      {!searchQuery && <SpecialsSlider items={menuItems} />}

      {/* Category Pills */}
      <CategoryPills
        categories={categories}
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
      />

      {/* Menu List */}
      {menuLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--ink3)' }}>
          <p style={{ fontSize: '13px', fontWeight: 600 }}>Loading artisanal menu…</p>
        </div>
      ) : groupedSections.length === 0 ? (
        <div
          className="tactile-card"
          style={{ textAlign: 'center', padding: '36px 20px', margin: '20px 0' }}
        >
          <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
            No dishes found
          </p>
          <p style={{ fontSize: '12.5px', color: 'var(--ink3)' }}>
            Try searching for another dish or select a different category.
          </p>
        </div>
      ) : (
        groupedSections.map(([category, items]) => (
          <section key={category} style={{ marginBottom: '20px' }}>
            <h2
              className="font-serif"
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: 'var(--ink2)',
                marginBottom: '10px',
                paddingLeft: '4px'
              }}
            >
              {category}
            </h2>
            {items.map((item) => (
              <MenuCard key={item.id || item.name} item={item} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
