import React from 'react';

export default function CategoryPills({ categories, activeCategory, onSelectCategory }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        padding: '2px 0 16px',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <button
        type="button"
        onClick={() => onSelectCategory('all')}
        style={{
          flexShrink: 0,
          padding: '8px 16px',
          borderRadius: '14px',
          border: '1px solid',
          borderColor: activeCategory === 'all' ? 'var(--ember)' : 'var(--glass-border)',
          background: activeCategory === 'all' ? 'var(--ember)' : '#FFFFFF',
          color: activeCategory === 'all' ? '#FFFFFF' : 'var(--ink2)',
          fontSize: '12.5px',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: activeCategory === 'all' ? 'var(--skeuo-btn-shadow)' : 'var(--skeuo-rim)',
          transition: 'all 0.15s ease'
        }}
      >
        All Items
      </button>

      {categories.map((cat) => {
        const isActive = activeCategory === cat;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onSelectCategory(cat)}
            style={{
              flexShrink: 0,
              padding: '8px 16px',
              borderRadius: '14px',
              border: '1px solid',
              borderColor: isActive ? 'var(--ember)' : 'var(--glass-border)',
              background: isActive ? 'var(--ember)' : '#FFFFFF',
              color: isActive ? '#FFFFFF' : 'var(--ink2)',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: isActive ? 'var(--skeuo-btn-shadow)' : 'var(--skeuo-rim)',
              transition: 'all 0.15s ease'
            }}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
